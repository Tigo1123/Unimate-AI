import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AIProvider } from '@unimate/ai';
import { AIProviderError } from '@unimate/ai';
import {
  gradingBatchMessages,
  type GradingPromptItem,
} from '../../infrastructure/ai/prompts/grading.prompt.js';
import { writeAiTelemetry } from '../../infrastructure/observability/ai-telemetry.js';
import { generationBatchTokenBudget } from './generation-optimization.js';

const gradeResultSchema = z.object({
  questionId: z.string().min(1),
  scorePercent: z.number().min(0).max(100),
  isCorrect: z.boolean(),
  feedback: z.string().min(3),
  missed: z.array(z.string()).max(10),
});
const gradeBatchSchema = z.object({ results: z.array(gradeResultSchema).min(1).max(100) });

export type OpenAnswerGrade = z.infer<typeof gradeResultSchema>;
export type OpenAnswerGradingItem = GradingPromptItem & { gradingKey: string };
const GRADING_PROMPT_TOKEN_RESERVE = 1_500;
const MAX_GRADING_RESULTS_PER_BATCH = 100;

export function estimatedGradingItemTokens(item: GradingPromptItem) {
  return (
    Math.ceil(
      (item.questionId.length +
        item.question.length +
        item.expectedAnswer.length +
        item.studentAnswer.length +
        item.source.length) /
        4,
    ) + 80
  );
}

export function tokenAwareGradingBatches<T extends GradingPromptItem>(
  items: T[],
  tokenBudget: number,
) {
  const contentBudget = tokenBudget - GRADING_PROMPT_TOKEN_RESERVE;
  if (contentBudget <= 0) throw new Error('Grading token budget is too small.');
  const batches: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const item of items) {
    const itemTokens = estimatedGradingItemTokens(item);
    if (itemTokens > contentBudget)
      throw new Error(`Open answer ${item.questionId} exceeds the safe grading input budget.`);
    if (
      current.length &&
      (tokens + itemTokens > contentBudget || current.length >= MAX_GRADING_RESULTS_PER_BATCH)
    ) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += itemTokens;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function stableGradingKey(input: {
  attemptId: string;
  item: GradingPromptItem;
  model: string;
  language: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        attemptId: input.attemptId,
        model: input.model,
        language: input.language,
        ...input.item,
      }),
    )
    .digest('hex');
}

function validateBatchResults(requested: GradingPromptItem[], results: OpenAnswerGrade[]) {
  const requestedIds = new Set(requested.map((item) => item.questionId));
  const returnedIds = new Set(results.map((result) => result.questionId));
  if (
    results.length !== requested.length ||
    returnedIds.size !== results.length ||
    returnedIds.size !== requestedIds.size ||
    [...returnedIds].some((id) => !requestedIds.has(id))
  )
    throw new AIProviderError(
      'INVALID_OUTPUT',
      'Gemini returned missing, duplicate, or unexpected open-answer grading IDs.',
    );
  return results;
}

export class GradingService {
  private readonly inFlight = new Map<string, Promise<OpenAnswerGrade[]>>();

  constructor(private readonly ai: AIProvider) {}

  async gradeBatch(input: {
    items: OpenAnswerGradingItem[];
    language: string;
    openAnswerCount: number;
    cacheHits: number;
  }) {
    if (input.items.length && this.ai.name === 'mock')
      throw new AIProviderError(
        'CONFIGURATION',
        'AI grading is unavailable in Demo mode. Configure a remote AI provider and retry.',
      );
    const startedAt = performance.now();
    const batches = tokenAwareGradingBatches(
      input.items,
      generationBatchTokenBudget(this.ai.name, this.ai.chatModel),
    );
    const estimatedInputTokens = batches.reduce(
      (sum, batch) =>
        sum +
        GRADING_PROMPT_TOKEN_RESERVE +
        batch.reduce((batchSum, item) => batchSum + estimatedGradingItemTokens(item), 0),
      0,
    );
    let providerRequests = 0;
    let sharedBatches = 0;
    const telemetry = (outcome: 'completed' | 'failed') =>
      writeAiTelemetry(outcome === 'completed' ? 'info' : 'warn', 'AI generation action', {
        feature: 'OPEN_ANSWER_GRADING',
        provider: this.ai.name,
        model: this.ai.chatModel,
        openAnswerCount: input.openAnswerCount,
        geminiRequests: this.ai.name === 'gemini' ? providerRequests : 0,
        estimatedInputTokens,
        batchCount: batches.length,
        cacheHits: input.cacheHits,
        cacheMisses: input.items.length,
        sharedBatches,
        totalLatencyMs: Math.round(performance.now() - startedAt),
        outcome,
      });
    try {
      const grades: OpenAnswerGrade[] = [];
      for (const batch of batches) {
        const batchKey = createHash('sha256')
          .update(batch.map((item) => item.gradingKey).join(':'))
          .digest('hex');
        let operation = this.inFlight.get(batchKey);
        if (operation) sharedBatches++;
        else {
          operation = (async () => {
            const result = await this.ai.generateStructured({
              messages: gradingBatchMessages({ items: batch, language: input.language }),
              schema: gradeBatchSchema,
              schemaName: 'open_answer_grades',
              mockValue: { results: [] },
            });
            providerRequests += result.providerRequests ?? 1;
            return validateBatchResults(batch, result.data.results);
          })();
          this.inFlight.set(batchKey, operation);
        }
        try {
          grades.push(...(await operation));
        } finally {
          if (this.inFlight.get(batchKey) === operation) this.inFlight.delete(batchKey);
        }
      }
      telemetry('completed');
      return grades;
    } catch (error) {
      if (error instanceof AIProviderError && error.providerRequests)
        providerRequests += error.providerRequests;
      telemetry('failed');
      throw error;
    }
  }

  async grade(input: Omit<GradingPromptItem, 'questionId'> & { language: string }) {
    const { language, ...gradingInput } = input;
    const questionId = 'single-question';
    const item = { questionId, ...gradingInput };
    return (
      await this.gradeBatch({
        items: [
          {
            ...item,
            gradingKey: stableGradingKey({
              attemptId: 'single',
              item,
              model: this.ai.chatModel,
              language,
            }),
          },
        ],
        language,
        openAnswerCount: 1,
        cacheHits: 0,
      })
    )[0]!;
  }
}
