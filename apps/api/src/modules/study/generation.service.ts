import type { PrismaClient, QuizDifficulty, QuestionType, SummaryType } from '@prisma/client';
import type { AIProvider } from '@unimate/ai';
import { AppError, notFound } from '../../shared/errors/app-error.js';
import {
  SUMMARY_PROMPT_VERSION,
  summaryMessages,
} from '../../infrastructure/ai/prompts/summary.prompt.js';
import {
  EXPLANATION_PROMPT_VERSION,
  explanationMessages,
} from '../../infrastructure/ai/prompts/explanation.prompt.js';
import { quizMessages } from '../../infrastructure/ai/prompts/quiz.prompt.js';
import { flashcardMessages } from '../../infrastructure/ai/prompts/flashcard.prompt.js';
import { writeAiTelemetry } from '../../infrastructure/observability/ai-telemetry.js';
import {
  estimatedInputTokens,
  generationBatchTokenBudget,
  stableGenerationKey,
  tokenAwareBatches,
} from './generation-optimization.js';
import {
  flashcardOutputSchema,
  quizOutputSchema,
  summaryOutputSchema,
} from './generation.schemas.js';

type Chunk = {
  id: string;
  sourceId: string;
  content: string;
  tokenCount: number;
  chunkIndex: number;
  pageStart: number | null;
  metadata: unknown;
  source: { displayName: string };
};
type GenerationSource = { sourceId: string; marker: string; displayName: string };
const generationSources = (chunks: Chunk[]): GenerationSource[] =>
  [...new Map(chunks.map((chunk) => [chunk.sourceId, chunk.source.displayName])).entries()].map(
    ([sourceId, displayName], index) => ({ sourceId, displayName, marker: `D${index + 1}` }),
  );
const contextText = (chunks: Chunk[], sources: GenerationSource[]) => {
  const markers = new Map(sources.map((source) => [source.sourceId, source.marker]));
  return JSON.stringify(
    chunks.map((chunk) => {
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      return {
        sourceMarker: `[${markers.get(chunk.sourceId)}]`,
        documentName: chunk.source.displayName,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        section: metadata.sectionTitle ?? metadata.sectionHeading ?? null,
        headingPath: Array.isArray(metadata.headingPath) ? metadata.headingPath : undefined,
        page: chunk.pageStart,
        content: chunk.content,
      };
    }),
  );
};
const legacyContextText = (chunks: Chunk[]) =>
  chunks
    .map((chunk) => {
      const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
      const section = metadata.sectionTitle ?? metadata.sectionHeading ?? 'Uncertain section';
      return `DOCUMENT: ${chunk.source.displayName}\nCHUNK: ${chunk.chunkIndex}\nSECTION: ${section}${chunk.pageStart ? `\nPAGE: ${chunk.pageStart}` : ''}\nCONTENT:\n${chunk.content}`;
    })
    .join('\n\n');
export function restrictDocumentCitationMarkers(content: string, sourceCount: number) {
  return content.replace(/\[D(\d+)\]/gi, (marker, value: string) => {
    const index = Number(value);
    return Number.isInteger(index) && index >= 1 && index <= sourceCount ? `[D${index}]` : '';
  });
}
function withServerSourceAppendix(content: string, sources: GenerationSource[]) {
  const restricted = restrictDocumentCitationMarkers(content, sources.length).trim();
  const appendix = sources.map((source) => `- [${source.marker}] ${source.displayName}`).join('\n');
  return `${restricted}\n\n## Sources\n\n${appendix}`;
}

export function summaryOutputTokenBudget(type: SummaryType, provider: AIProvider['name']) {
  const visible =
    type === 'SHORT'
      ? 2_500
      : type === 'DETAILED'
        ? 7_000
        : type === 'EXAM_REVISION'
          ? 5_500
          : 4_500;
  return provider === 'gemini' ? visible + 2_000 : visible;
}

export function explanationOutputTokenBudget(
  mode: 'SIMPLE' | 'STANDARD' | 'DETAILED' | 'EXAM_PREPARATION',
  provider: AIProvider['name'],
) {
  const visible =
    mode === 'SIMPLE'
      ? 4_000
      : mode === 'DETAILED'
        ? 9_000
        : mode === 'EXAM_PREPARATION'
          ? 7_000
          : 6_000;
  return provider === 'gemini' ? visible + 2_000 : visible;
}
const sample = <T>(items: T[], count: number) =>
  Array.from(
    { length: Math.min(count, items.length) },
    (_, index) => items[Math.floor((index * items.length) / Math.min(count, items.length))]!,
  );
export const QUIZ_QUESTION_BATCH_SIZE = 6;
export function quizQuestionBatchSizes(count: number, batchSize = QUIZ_QUESTION_BATCH_SIZE) {
  return Array.from({ length: Math.ceil(count / batchSize) }, (_, index) =>
    Math.min(batchSize, count - index * batchSize),
  );
}
const readableDemoChunk = (chunk: Chunk) => {
  const text = chunk.content.trim();
  const body = /\n\s*\n|^#{1,6}\s|^[-*]\s/m.test(text)
    ? text
    : (text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text])
        .reduce<string[]>((paragraphs, sentence, index) => {
          const group = Math.floor(index / 3);
          paragraphs[group] = `${paragraphs[group] ?? ''}${sentence.trim()} `;
          return paragraphs;
        }, [])
        .map((paragraph) => paragraph.trim())
        .join('\n\n');
  return `### ${chunk.source.displayName}${chunk.pageStart ? ` — Page ${chunk.pageStart}` : ''}\n\n${body}`;
};
const fallbackOutline = (courseName: string, chunks: Chunk[]) => {
  const sections = new Map<string, string[]>();
  for (const chunk of chunks) {
    const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
    const title =
      typeof metadata.sectionTitle === 'string'
        ? metadata.sectionTitle
        : `${chunk.source.displayName} — chunk ${chunk.chunkIndex + 1}`;
    const preview = chunk.content
      .replace(/^#{1,6}\s+.*$/gm, '')
      .trim()
      .slice(0, 420);
    if (preview) sections.set(title, [...(sections.get(title) ?? []), preview]);
  }
  return `> **Demo mode:** Remote AI is not configured. This is an organized source outline, not a generated tutor explanation.\n\n# ${courseName} Source Outline\n\n${[...sections].map(([title, items]) => `## ${title}\n\n${items.slice(0, 2).join('\n\n')}`).join('\n\n')}`;
};

export class GenerationService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ai: AIProvider,
  ) {}

  private async cachedAction<T>(input: {
    key: string;
    feature: string;
    chunks: Chunk[];
    batchCount: number;
    synthesisRequired: boolean;
    findCached: () => Promise<T | null>;
    generate: () => Promise<{ value: T; providerRequests: number }>;
  }): Promise<T> {
    const startedAt = performance.now();
    const telemetry = (
      cacheStatus: 'HIT' | 'MISS' | 'IN_FLIGHT',
      providerRequests: number,
      outcome: 'completed' | 'failed',
    ) =>
      writeAiTelemetry(outcome === 'completed' ? 'info' : 'warn', 'AI generation action', {
        feature: input.feature,
        provider: this.ai.name,
        model: this.ai.chatModel,
        geminiRequests: this.ai.name === 'gemini' ? providerRequests : 0,
        inputCharacters: input.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
        estimatedInputTokens: estimatedInputTokens(input.chunks),
        chunkCount: input.chunks.length,
        batchCount: input.batchCount,
        synthesisRequired: input.synthesisRequired,
        synthesisRequestCount:
          outcome === 'completed' && cacheStatus === 'MISS' && input.synthesisRequired ? 1 : 0,
        cacheStatus,
        totalLatencyMs: Math.round(performance.now() - startedAt),
        outcome,
      });

    const cached = await input.findCached();
    if (cached) {
      telemetry('HIT', 0, 'completed');
      return cached;
    }
    const active = this.inFlight.get(input.key) as Promise<T> | undefined;
    if (active) {
      try {
        const value = await active;
        telemetry('IN_FLIGHT', 0, 'completed');
        return value;
      } catch (error) {
        telemetry('IN_FLIGHT', 0, 'failed');
        throw error;
      }
    }
    const operation = (async () => {
      const secondCheck = await input.findCached();
      if (secondCheck) return secondCheck;
      const generated = await input.generate();
      telemetry('MISS', generated.providerRequests, 'completed');
      return generated.value;
    })();
    this.inFlight.set(input.key, operation);
    try {
      return await operation;
    } catch (error) {
      const requests =
        typeof error === 'object' && error && 'providerRequests' in error
          ? Number(error.providerRequests) || 0
          : 0;
      telemetry('MISS', requests, 'failed');
      throw error;
    } finally {
      if (this.inFlight.get(input.key) === operation) this.inFlight.delete(input.key);
    }
  }
  private async material(userId: string, courseId: string, sourceIds: string[] = []) {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, userId },
      include: { user: { include: { profile: true } } },
    });
    if (!course) throw notFound('course');
    if (sourceIds.length) {
      const owned = await this.prisma.source.count({
        where: { id: { in: sourceIds }, userId, courseId, processingStatus: 'READY' },
      });
      if (owned !== sourceIds.length)
        throw new AppError(
          400,
          'INVALID_SOURCE_SCOPE',
          'One or more selected sources are unavailable or still processing.',
        );
    }
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        userId,
        courseId,
        source: { processingStatus: 'READY' },
        ...(sourceIds.length ? { sourceId: { in: sourceIds } } : {}),
      },
      include: { source: { select: { displayName: true } } },
      orderBy: [{ sourceId: 'asc' }, { chunkIndex: 'asc' }],
    });
    if (!chunks.length)
      throw new AppError(
        409,
        'NO_READY_CONTENT',
        'Wait for at least one source to finish creating its study index.',
      );
    return { course, chunks, language: course.user.profile?.aiResponseLanguage || 'English' };
  }
  async summary(input: {
    userId: string;
    courseId: string;
    sourceIds: string[];
    type: SummaryType;
    title?: string;
  }) {
    const { course, chunks, language } = await this.material(
      input.userId,
      input.courseId,
      input.sourceIds,
    );
    if (this.ai.name === 'mock') {
      const content = fallbackOutline(course.name, chunks);
      return this.prisma.summary.create({
        data: {
          userId: input.userId,
          courseId: input.courseId,
          title: `${course.name} source outline`,
          content,
          type: input.type,
          sources: {
            create: [...new Set(chunks.map((chunk) => chunk.sourceId))].map((sourceId) => ({
              sourceId,
            })),
          },
        },
        include: {
          sources: {
            include: { source: { select: { id: true, displayName: true, pageCount: true } } },
          },
        },
      });
    }
    const batches = tokenAwareBatches(
      chunks,
      generationBatchTokenBudget(this.ai.name, this.ai.chatModel),
    );
    const sources = generationSources(chunks);
    const key = stableGenerationKey({
      userId: input.userId,
      courseId: input.courseId,
      feature: 'SUMMARY',
      model: this.ai.chatModel,
      language,
      parameters: {
        promptVersion: SUMMARY_PROMPT_VERSION,
        type: input.type,
        title: input.title ?? null,
        sourceIds: [...input.sourceIds].sort(),
      },
      chunks,
    });
    const include = {
      sources: {
        orderBy: { sourceId: 'asc' as const },
        include: { source: { select: { id: true, displayName: true, pageCount: true } } },
      },
    } as const;
    return this.cachedAction({
      key,
      feature: 'SUMMARY',
      chunks,
      batchCount: batches.length,
      synthesisRequired: batches.length > 1,
      findCached: () => this.prisma.summary.findUnique({ where: { generationKey: key }, include }),
      generate: async () => {
        let providerRequests = 0;
        const partials: string[] = [];
        for (const batch of batches) {
          const result = await this.ai.generateStructured({
            messages: summaryMessages({
              type: input.type,
              language,
              content: contextText(batch, sources),
            }),
            schema: summaryOutputSchema,
            schemaName: 'summary',
            maxOutputTokens: summaryOutputTokenBudget(input.type, this.ai.name),
            mockValue: {
              title: `${course.name} — partial`,
              content: batch.map((chunk) => readableDemoChunk(chunk)).join('\n\n'),
            },
          });
          providerRequests += result.providerRequests ?? 1;
          partials.push(result.data.content);
        }
        let final = { title: input.title ?? `${course.name} summary`, content: partials[0]! };
        if (partials.length > 1) {
          const result = await this.ai.generateStructured({
            messages: summaryMessages({
              type: input.type,
              language,
              content: JSON.stringify(
                partials.map((partial, index) => ({ partial: index + 1, content: partial })),
              ),
              final: true,
            }),
            schema: summaryOutputSchema,
            schemaName: 'summary',
            maxOutputTokens: summaryOutputTokenBudget(input.type, this.ai.name),
            mockValue: { title: final.title, content: partials.join('\n\n') },
          });
          providerRequests += result.providerRequests ?? 1;
          final = result.data;
        }
        const value = await this.prisma.summary.create({
          data: {
            userId: input.userId,
            courseId: input.courseId,
            title: input.title ?? final.title,
            content: withServerSourceAppendix(final.content, sources),
            type: input.type,
            generationKey: key,
            sources: {
              create: [...new Set(chunks.map((chunk) => chunk.sourceId))].map((sourceId) => ({
                sourceId,
              })),
            },
          },
          include,
        });
        return { value, providerRequests };
      },
    });
  }
  async explanation(input: {
    userId: string;
    courseId: string;
    sourceIds: string[];
    mode: 'SIMPLE' | 'STANDARD' | 'DETAILED' | 'EXAM_PREPARATION';
  }) {
    const { course, chunks, language } = await this.material(
      input.userId,
      input.courseId,
      input.sourceIds,
    );
    if (this.ai.name === 'mock') {
      const content = fallbackOutline(course.name, chunks);
      return this.prisma.summary.create({
        data: {
          userId: input.userId,
          courseId: input.courseId,
          title: `${course.name} source outline`,
          content,
          type: input.mode === 'EXAM_PREPARATION' ? 'EXAM_REVISION' : 'DETAILED',
          sources: {
            create: [...new Set(chunks.map((chunk) => chunk.sourceId))].map((sourceId) => ({
              sourceId,
            })),
          },
        },
        include: {
          sources: {
            include: { source: { select: { id: true, displayName: true, pageCount: true } } },
          },
        },
      });
    }
    const batches = tokenAwareBatches(
      chunks,
      generationBatchTokenBudget(this.ai.name, this.ai.chatModel),
    );
    const sources = generationSources(chunks);
    const key = stableGenerationKey({
      userId: input.userId,
      courseId: input.courseId,
      feature: 'EXPLAIN',
      model: this.ai.chatModel,
      language,
      parameters: {
        promptVersion: EXPLANATION_PROMPT_VERSION,
        mode: input.mode,
        sourceIds: [...input.sourceIds].sort(),
      },
      chunks,
    });
    const include = {
      sources: {
        orderBy: { sourceId: 'asc' as const },
        include: { source: { select: { id: true, displayName: true, pageCount: true } } },
      },
    } as const;
    return this.cachedAction({
      key,
      feature: 'EXPLAIN',
      chunks,
      batchCount: batches.length,
      synthesisRequired: batches.length > 1,
      findCached: () => this.prisma.summary.findUnique({ where: { generationKey: key }, include }),
      generate: async () => {
        let providerRequests = 0;
        const partials: string[] = [];
        for (const batch of batches) {
          const result = await this.ai.generateStructured({
            messages: explanationMessages({
              mode: input.mode,
              language,
              content: contextText(batch, sources),
            }),
            schema: summaryOutputSchema,
            schemaName: 'lecture_explanation',
            maxOutputTokens: explanationOutputTokenBudget(input.mode, this.ai.name),
            mockValue: {
              title: `${course.name} explanation`,
              content: batch.map((chunk) => readableDemoChunk(chunk)).join('\n\n'),
            },
          });
          providerRequests += result.providerRequests ?? 1;
          partials.push(result.data.content);
        }
        let final = { title: `${course.name} explanation`, content: partials[0]! };
        if (partials.length > 1) {
          const result = await this.ai.generateStructured({
            messages: explanationMessages({
              mode: input.mode,
              language,
              content: JSON.stringify(
                partials.map((partial, index) => ({ partial: index + 1, content: partial })),
              ),
              final: true,
            }),
            schema: summaryOutputSchema,
            schemaName: 'lecture_explanation',
            maxOutputTokens: explanationOutputTokenBudget(input.mode, this.ai.name),
            mockValue: { title: final.title, content: partials.join('\n\n') },
          });
          providerRequests += result.providerRequests ?? 1;
          final = result.data;
        }
        const value = await this.prisma.summary.create({
          data: {
            userId: input.userId,
            courseId: input.courseId,
            title: final.title,
            content: withServerSourceAppendix(final.content, sources),
            type: input.mode === 'EXAM_PREPARATION' ? 'EXAM_REVISION' : 'DETAILED',
            generationKey: key,
            sources: {
              create: [...new Set(chunks.map((chunk) => chunk.sourceId))].map((sourceId) => ({
                sourceId,
              })),
            },
          },
          include,
        });
        return { value, providerRequests };
      },
    });
  }
  async flashcards(input: {
    userId: string;
    courseId: string;
    sourceIds: string[];
    count: number;
    title: string;
  }) {
    if (this.ai.name === 'mock')
      throw new AppError(
        503,
        'AI_DEMO_UNAVAILABLE',
        'Flashcard generation is unavailable in Demo mode. Configure a remote AI provider and retry.',
      );
    const { chunks, language } = await this.material(input.userId, input.courseId, input.sourceIds);
    const selected = sample(chunks, Math.min(Math.max(input.count, 12), 30));
    const key = stableGenerationKey({
      userId: input.userId,
      courseId: input.courseId,
      feature: 'FLASHCARDS',
      model: this.ai.chatModel,
      language,
      parameters: {
        count: input.count,
        title: input.title,
        sourceIds: [...input.sourceIds].sort(),
      },
      chunks,
    });
    const mockCards = Array.from({ length: input.count }, (_, index) => {
      const chunk = selected[index % selected.length]!;
      return {
        front: `What is the key concept in section ${index + 1}?`,
        back: chunk.content.slice(0, 500),
        topic: chunk.source.displayName.replace(/\.[^.]+$/, ''),
        difficulty: 'MEDIUM' as const,
        sourceChunkIndex: index % selected.length,
      };
    });
    return this.cachedAction({
      key,
      feature: 'FLASHCARDS',
      chunks: selected,
      batchCount: 1,
      synthesisRequired: false,
      findCached: () =>
        this.prisma.flashcardSet.findUnique({
          where: { generationKey: key },
          include: { cards: true },
        }),
      generate: async () => {
        const result = await this.ai.generateStructured({
          messages: flashcardMessages({
            count: input.count,
            language,
            context: legacyContextText(selected),
          }),
          schema: flashcardOutputSchema,
          schemaName: 'flashcard_set',
          mockValue: { cards: mockCards },
        });
        const output = result.data;
        if (output.cards.length !== input.count)
          throw new AppError(
            502,
            'AI_INVALID_OUTPUT',
            'The AI did not return the requested number of flashcards. Please retry.',
          );
        const value = await this.prisma.flashcardSet.create({
          data: {
            userId: input.userId,
            courseId: input.courseId,
            title: input.title,
            generationKey: key,
            sources: {
              create: [...new Set(selected.map((chunk) => chunk.sourceId))].map((sourceId) => ({
                sourceId,
              })),
            },
            cards: {
              create: output.cards.map((card) => {
                const chunk = selected[Math.min(card.sourceChunkIndex, selected.length - 1)]!;
                return {
                  userId: input.userId,
                  courseId: input.courseId,
                  sourceId: chunk.sourceId,
                  front: card.front,
                  back: card.back,
                  topic: card.topic,
                  difficulty: card.difficulty,
                };
              }),
            },
          },
          include: { cards: true },
        });
        return { value, providerRequests: result.providerRequests ?? 1 };
      },
    });
  }
  async quiz(input: {
    userId: string;
    courseId: string;
    sourceIds: string[];
    count: number;
    title: string;
    difficulty: QuizDifficulty;
    questionType: QuestionType;
  }) {
    if (this.ai.name === 'mock')
      throw new AppError(
        503,
        'AI_DEMO_UNAVAILABLE',
        'Quiz generation is unavailable in Demo mode. Configure a remote AI provider and retry.',
      );
    const { chunks, language } = await this.material(input.userId, input.courseId, input.sourceIds);
    const selected = sample(chunks, Math.min(Math.max(input.count, 12), 30));
    const key = stableGenerationKey({
      userId: input.userId,
      courseId: input.courseId,
      feature: 'CREATE_EXAM_QUESTIONS',
      model: this.ai.chatModel,
      language,
      parameters: {
        count: input.count,
        title: input.title,
        difficulty: input.difficulty,
        questionType: input.questionType,
        sourceIds: [...input.sourceIds].sort(),
      },
      chunks,
    });
    const mockQuestions = Array.from({ length: input.count }, (_, index) => {
      const chunk = selected[index % selected.length]!;
      const answer =
        chunk.content.split(/(?<=[.!?])\s+/)[0]?.slice(0, 300) ?? chunk.content.slice(0, 300);
      const objective =
        input.questionType === 'MULTIPLE_CHOICE' || input.questionType === 'TRUE_FALSE';
      return {
        type: input.questionType,
        prompt:
          input.questionType === 'TRUE_FALSE'
            ? `True or false: ${answer}`
            : `Explain this concept from the source: ${answer.slice(0, 100)}`,
        options:
          input.questionType === 'TRUE_FALSE'
            ? ['True', 'False']
            : input.questionType === 'MULTIPLE_CHOICE'
              ? [
                  answer,
                  'A related but different concept',
                  'An unsupported interpretation',
                  'None of these',
                ]
              : [],
        correctAnswer: objective && input.questionType === 'TRUE_FALSE' ? 'True' : answer,
        explanation: chunk.content.slice(0, 500),
        difficulty:
          input.difficulty === 'MIXED'
            ? (['EASY', 'MEDIUM', 'HARD'] as const)[index % 3]!
            : input.difficulty,
        topic: chunk.source.displayName.replace(/\.[^.]+$/, ''),
        sourceChunkIndex: index % selected.length,
      };
    });
    const questionBatchSizes = quizQuestionBatchSizes(input.count);
    return this.cachedAction({
      key,
      feature: 'CREATE_EXAM_QUESTIONS',
      chunks: selected,
      batchCount: questionBatchSizes.length,
      synthesisRequired: false,
      findCached: () =>
        this.prisma.quiz.findUnique({
          where: { generationKey: key },
          include: { questions: true },
        }),
      generate: async () => {
        let providerRequests = 0;
        const questions: typeof mockQuestions = [];
        for (const batchCount of questionBatchSizes) {
          const result = await this.ai.generateStructured({
            messages: quizMessages({
              count: batchCount,
              difficulty: input.difficulty,
              questionType: input.questionType,
              language,
              context: legacyContextText(selected),
            }),
            schema: quizOutputSchema,
            schemaName: 'quiz',
            mockValue: { questions: mockQuestions.slice(questions.length, questions.length + batchCount) },
          });
          providerRequests += result.providerRequests ?? 1;
          if (result.data.questions.length !== batchCount)
            throw new AppError(
              502,
              'AI_INVALID_OUTPUT',
              `The AI returned ${result.data.questions.length} of ${batchCount} questions in a quiz batch. Please retry.`,
            );
          questions.push(...result.data.questions);
        }
        const value = await this.prisma.quiz.create({
          data: {
            userId: input.userId,
            courseId: input.courseId,
            title: input.title,
            difficulty: input.difficulty,
            generationKey: key,
            sources: {
              create: [...new Set(selected.map((chunk) => chunk.sourceId))].map((sourceId) => ({
                sourceId,
              })),
            },
            questions: {
              create: questions.map((question, index) => {
                const chunk = selected[Math.min(question.sourceChunkIndex, selected.length - 1)]!;
                return {
                  position: index + 1,
                  type: question.type,
                  prompt: question.prompt,
                  options: question.options,
                  correctAnswer: question.correctAnswer,
                  explanation: question.explanation,
                  difficulty: question.difficulty,
                  topic: question.topic,
                  sourceId: chunk.sourceId,
                  documentChunkId: chunk.id,
                };
              }),
            },
          },
          include: { questions: true },
        });
        return { value, providerRequests };
      },
    });
  }
}
