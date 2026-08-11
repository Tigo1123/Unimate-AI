import type { PrismaClient } from '@prisma/client';
import type { AIMessage, AIProvider } from '@unimate/ai';
import { AIProviderError } from '@unimate/ai';
import { AppError, notFound } from '../../shared/errors/app-error.js';
import { writeAiTelemetry } from '../../infrastructure/observability/ai-telemetry.js';
import { buildTutorMessages } from '../../infrastructure/ai/prompts/tutor.prompt.js';
import type { StudyAction } from '../../infrastructure/ai/prompts/tutor.prompt.js';
import type { RetrievalService } from './retrieval.service.js';
import {
  boundedConversationHistory,
  buildTutorContext,
  conversationAwareRetrievalQuery,
  detectRagIntent,
  ensureSourceReferences,
  hasSufficientQuestionEvidence,
  normalizeCitationMarkers,
  restrictCitationMarkers,
  selectDocumentContextByTokenBudget,
  selectQuestionContext,
} from './rag-context.js';

function missingMaterialMessage(language: string) {
  return /arabic|العربية|عربي/i.test(language)
    ? 'لا تغطي المواد المرفوعة هذه النقطة بوضوح. يمكنني شرحها بالاعتماد على المعرفة العامة إذا رغبت.'
    : 'The uploaded material does not clearly cover this point. I can explain it using general knowledge if you want.';
}

export const actionOutputTokens: Record<StudyAction, number> = {
  EXPLAIN: 2600,
  SUMMARIZE: 1800,
  CREATE_EXAM_QUESTIONS: 2600,
  STUDY_FIRST: 2200,
  SIMPLIFY: 1600,
  EXAM_PREP: 2600,
};

export function providerOutputTokens(action: StudyAction, provider: AIProvider['name']) {
  const visibleAnswerBudget = actionOutputTokens[action];
  // Gemini counts internal thinking against maxOutputTokens. Reserve a second
  // visible-answer-sized allowance so reasoning cannot truncate the response.
  return provider === 'gemini' ? visibleAnswerBudget * 2 : visibleAnswerBudget;
}

export function finishChatContent(content: string, finishReason?: string) {
  if (finishReason !== 'length') return content;
  const endings = [...content.matchAll(/[.!?](?:["')\]]?)(?=\s|$)/g)];
  const lastComplete = endings.at(-1);
  const safelyCompleted = lastComplete
    ? content.slice(0, lastComplete.index! + lastComplete[0].length)
    : content.trim();
  return `${safelyCompleted.trim()}\n\n> Response shortened at the provider's output limit. Ask for a continuation if you need more detail.`;
}

export class RagChatService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ai: AIProvider,
    private readonly retrieval: RetrievalService,
    private readonly topK: number,
  ) {}
  async answer(input: {
    userId: string;
    conversationId: string;
    content: string;
    mode: 'EXPLAIN' | 'SIMPLIFY' | 'SUMMARIZE' | 'STUDY' | 'EXAM_PREP';
    action?: StudyAction;
    sourceIds?: string[];
  }) {
    const requestStartedAt = performance.now();
    const requestTag = `rag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const setupStartedAt = performance.now();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      include: { course: true },
    });
    if (!conversation) throw notFound('conversation');
    if (input.sourceIds?.length) {
      const count = await this.prisma.source.count({
        where: {
          id: { in: input.sourceIds },
          userId: input.userId,
          courseId: conversation.courseId,
          processingStatus: 'READY',
        },
      });
      if (count !== input.sourceIds.length)
        throw new AppError(
          400,
          'INVALID_SOURCE_SCOPE',
          'One or more selected sources are unavailable or still processing.',
        );
    }
    const intent = detectRagIntent(input.content, input.mode);
    const action: StudyAction =
      input.action ??
      (input.mode === 'SIMPLIFY'
        ? 'SIMPLIFY'
        : input.mode === 'SUMMARIZE'
          ? 'SUMMARIZE'
          : input.mode === 'STUDY'
            ? 'STUDY_FIRST'
            : input.mode === 'EXAM_PREP'
              ? 'EXAM_PREP'
              : intent === 'SUMMARIZE_DOCUMENT'
                ? 'SUMMARIZE'
                : 'EXPLAIN');
    const documentLevel = intent !== 'QUESTION';
    const setupMs = performance.now() - setupStartedAt;
    const retrievalStartedAt = performance.now();
    const [recent, profile] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id, status: 'COMPLETE' },
        select: { role: true, content: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.userProfile.findUnique({
        where: { userId: input.userId },
        select: { aiResponseLanguage: true },
      }),
    ]);
    const retrievalQuery = conversationAwareRetrievalQuery(input.content, recent);
    const retrieved = documentLevel
      ? await this.retrieval.retrieveDocument({
          userId: input.userId,
          courseId: conversation.courseId,
          ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
        })
      : await this.retrieval.retrieve({
          userId: input.userId,
          courseId: conversation.courseId,
          ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
          query: retrievalQuery,
          limit: this.topK * 2,
        });
    const retrievalMs = performance.now() - retrievalStartedAt;
    const selectionStartedAt = performance.now();
    let chunks = documentLevel ? selectDocumentContextByTokenBudget(retrieved) : [];
    if (!documentLevel && hasSufficientQuestionEvidence(retrieved)) {
      const anchors = retrieved.slice(0, Math.min(4, this.topK));
      const neighbors = await this.retrieval.retrieveNeighbors({
        userId: input.userId,
        courseId: conversation.courseId,
        ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
        anchors,
      });
      chunks = selectQuestionContext(anchors, neighbors, this.topK);
    }
    if (process.env.NODE_ENV === 'development') {
      console.info('[RAG]', {
        intent,
        documentIds: [...new Set(chunks.map((chunk) => chunk.sourceId))],
        retrievalQuery,
        chunkCount: chunks.length,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          score: Number(chunk.similarity).toFixed(3),
          chunkIndex: chunk.chunkIndex,
          sectionTitle: chunk.metadata?.sectionTitle ?? chunk.metadata?.sectionHeading,
          preview: chunk.content.replace(/\s+/g, ' ').slice(0, 100),
        })),
        finalChunkOrder: chunks.map((chunk) => `${chunk.sourceId}:${chunk.chunkIndex}`),
        generator: this.ai.name !== 'mock' ? this.ai.name : 'Demo/Fallback',
      });
    }
    const selectionMs = performance.now() - selectionStartedAt;
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        userId: input.userId,
        role: 'USER',
        content: input.content,
      },
    });
    if (!chunks.length) {
      const assistant = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: missingMaterialMessage(profile?.aiResponseLanguage || 'English'),
          modelProvider: this.ai.name,
          modelName: this.ai.chatModel,
        },
      });
      return { userMessage, assistant: { ...assistant, citations: [] } };
    }
    const history: AIMessage[] = boundedConversationHistory(recent);
    let promptMs = 0;
    let promptCharacters = 0;
    let providerStartedAt = 0;
    try {
      const promptStartedAt = performance.now();
      const messages = buildTutorMessages({
        question: input.content,
        mode: input.mode,
        language: profile?.aiResponseLanguage || 'English',
        courseName: conversation.course.name,
        history,
        intent,
        action,
        context: buildTutorContext(chunks),
        coverage: {
          selectedChunks: chunks.length,
          availableChunks: retrieved.length,
          complete: documentLevel && chunks.length === retrieved.length,
        },
      });
      promptMs = performance.now() - promptStartedAt;
      promptCharacters = messages.reduce((sum, message) => sum + message.content.length, 0);
      providerStartedAt = performance.now();
      const result = await this.ai.chat({
        messages,
        maxOutputTokens: providerOutputTokens(action, this.ai.name),
      });
      const providerMs = performance.now() - providerStartedAt;
      const responseProcessingStartedAt = performance.now();
      const normalizedContent = ensureSourceReferences(
        restrictCitationMarkers(
          normalizeCitationMarkers(finishChatContent(result.content, result.finishReason)),
          chunks.length,
        ),
        chunks.length,
      );
      const referencedIndexes = [...normalizedContent.matchAll(/\[S(\d+)\]/g)]
        .map((match) => Number(match[1]) - 1)
        .filter(
          (index, position, indexes) =>
            Number.isInteger(index) &&
            index >= 0 &&
            index < chunks.length &&
            indexes.indexOf(index) === position,
        );
      const referencedChunks = referencedIndexes
        .map((index) => chunks[index])
        .filter((chunk): chunk is (typeof chunks)[number] => Boolean(chunk));
      const citedChunks = referencedChunks;
      const assistant = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: normalizedContent,
          modelProvider: this.ai.name,
          modelName: result.model,
          promptTokens: result.usage?.inputTokens ?? null,
          completionTokens: result.usage?.outputTokens ?? null,
          citations: {
            create: citedChunks.map((chunk) => ({
              sourceId: chunk.sourceId,
              documentChunkId: chunk.id,
              citationOrder: chunks.indexOf(chunk) + 1,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              quotedExcerpt: chunk.content.slice(0, 500),
            })),
          },
        },
        include: {
          citations: {
            include: {
              source: { select: { displayName: true } },
              documentChunk: { select: { metadata: true } },
            },
            orderBy: { citationOrder: 'asc' },
          },
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          mode: input.mode,
          title:
            conversation.title === 'New conversation'
              ? input.content.slice(0, 80)
              : conversation.title,
        },
      });
      const responseProcessingMs = performance.now() - responseProcessingStartedAt;
      const timing = {
        requestTag,
        outcome: 'completed',
        intent,
        action,
        documentLevel,
        setupMs: Math.round(setupMs),
        retrievalMs: Math.round(retrievalMs),
        selectionMs: Math.round(selectionMs),
        promptConstructionMs: Math.round(promptMs),
        geminiMs: Math.round(providerMs),
        responseProcessingMs: Math.round(responseProcessingMs),
        totalMs: Math.round(performance.now() - requestStartedAt),
        retrievedChunkCount: retrieved.length,
        selectedChunkCount: chunks.length,
        selectedContextCharacters: chunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
        promptCharacters,
        promptTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        maxOutputTokens: providerOutputTokens(action, this.ai.name),
        feature: `CHAT_${action}`,
        provider: this.ai.name,
        model: this.ai.chatModel,
        geminiRequests: this.ai.name === 'gemini' ? (result.providerRequests ?? 1) : 0,
        estimatedInputTokens: Math.ceil(promptCharacters / 4),
        batchCount: 1,
        synthesisRequired: false,
        cacheStatus: 'MISS',
      };
      writeAiTelemetry('info', 'RAG request timing', timing);
      console.info('[RAG request timing]', timing);
      return { userMessage, assistant, aiMode: this.ai.name !== 'mock' ? 'AI_TUTOR' : 'FALLBACK' };
    } catch (error) {
      const timing = {
        requestTag,
        outcome: 'failed',
        intent,
        action,
        documentLevel,
        setupMs: Math.round(setupMs),
        retrievalMs: Math.round(retrievalMs),
        selectionMs: Math.round(selectionMs),
        promptConstructionMs: Math.round(promptMs),
        geminiMs: providerStartedAt ? Math.round(performance.now() - providerStartedAt) : 0,
        responseProcessingMs: 0,
        totalMs: Math.round(performance.now() - requestStartedAt),
        retrievedChunkCount: retrieved.length,
        selectedChunkCount: chunks.length,
        selectedContextCharacters: chunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
        promptCharacters,
        feature: `CHAT_${action}`,
        provider: this.ai.name,
        model: this.ai.chatModel,
        geminiRequests:
          this.ai.name === 'gemini' && error instanceof AIProviderError
            ? (error.providerRequests ?? 1)
            : 0,
        estimatedInputTokens: Math.ceil(promptCharacters / 4),
        batchCount: 1,
        synthesisRequired: false,
        cacheStatus: 'MISS',
      };
      writeAiTelemetry('warn', 'RAG request timing', timing);
      console.info('[RAG request timing]', timing);
      const rateLimited = error instanceof AIProviderError && error.code === 'RATE_LIMITED';
      const retryAfterSeconds =
        error instanceof AIProviderError && error.retryAfterMs
          ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
          : undefined;
      const failureMessage = rateLimited
        ? error instanceof AIProviderError && error.rateLimitScope === 'DAY'
          ? "Gemini's free daily quota is exhausted. AI generation will be available after the daily quota resets at midnight Pacific time."
          : `You're asking questions quickly! Please wait about ${retryAfterSeconds ?? 'a few'} seconds before your next question.`
        : 'The AI tutor is temporarily unavailable. Please retry.';
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          userId: input.userId,
          role: 'ASSISTANT',
          content: failureMessage,
          status: 'FAILED',
          modelProvider: this.ai.name,
          modelName: this.ai.chatModel,
        },
      });
      throw new AppError(
        rateLimited ? 429 : 503,
        rateLimited ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE',
        failureMessage,
        retryAfterSeconds
          ? {
              retryAfterSeconds,
              ...(error instanceof AIProviderError && error.rateLimitScope
                ? { rateLimitScope: error.rateLimitScope }
                : {}),
            }
          : undefined,
      );
    }
  }
}
