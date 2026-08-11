import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '@unimate/ai';
import { AIProviderError } from '@unimate/ai';
import { writeAiTelemetry } from '../../infrastructure/observability/ai-telemetry.js';
import {
  GradingService,
  stableGradingKey,
  tokenAwareGradingBatches,
  type OpenAnswerGradingItem,
} from './grading.service.js';

vi.mock('../../infrastructure/observability/ai-telemetry.js', () => ({
  writeAiTelemetry: vi.fn(),
}));

function items(
  count: number,
  answerCharacters = 1_000,
  sourceCharacters = 3_800,
): OpenAnswerGradingItem[] {
  return Array.from({ length: count }, (_, index) => ({
    questionId: `question-${index + 1}`,
    question: `Explain concept ${index + 1}.`,
    expectedAnswer: `Expected concept ${index + 1}`,
    studentAnswer: 'a'.repeat(answerCharacters),
    source: `Source material ${index + 1} ${'s'.repeat(sourceCharacters)}`,
    gradingKey: `key-${index + 1}`,
  }));
}

function resultFor(batch: OpenAnswerGradingItem[]) {
  return batch.map((item) => ({
    questionId: item.questionId,
    scorePercent: 80,
    isCorrect: true,
    feedback: 'Good answer with the main concept.',
    missed: ['One supporting detail'],
  }));
}

function fixture(
  responder: (batch: OpenAnswerGradingItem[]) => unknown = (batch) => ({
    results: resultFor(batch),
  }),
) {
  const generateStructured = vi.fn().mockImplementation(async ({ messages }) => {
    const payload = JSON.parse(messages[1].content) as {
      gradingItems: OpenAnswerGradingItem[];
    };
    return {
      data: responder(payload.gradingItems),
      model: 'gemini-3.5-flash',
      providerRequests: 1,
    };
  });
  const ai = {
    name: 'gemini',
    chatModel: 'gemini-3.5-flash',
    embeddingModel: 'local-hash-v1',
    generateStructured,
  } as unknown as AIProvider;
  return { service: new GradingService(ai), generateStructured };
}

describe('GradingService batch optimization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses no provider request when there are no open answers to grade', async () => {
    const { service, generateStructured } = fixture();
    await expect(
      service.gradeBatch({
        items: [],
        language: 'English',
        openAnswerCount: 0,
        cacheHits: 0,
      }),
    ).resolves.toEqual([]);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it.each([1, 5, 10, 20])(
    'grades %i max-length answers with normal source chunks in one Gemini request',
    async (count) => {
      const { service, generateStructured } = fixture();
      const grades = await service.gradeBatch({
        items: items(count),
        language: 'English',
        openAnswerCount: count,
        cacheHits: 0,
      });
      expect(grades).toHaveLength(count);
      expect(generateStructured).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['missing', (batch: OpenAnswerGradingItem[]) => resultFor(batch).slice(1)],
    ['duplicate', (batch: OpenAnswerGradingItem[]) => [resultFor(batch)[0], resultFor(batch)[0]]],
    [
      'unexpected',
      (batch: OpenAnswerGradingItem[]) => [
        resultFor(batch)[0],
        { ...resultFor(batch)[1]!, questionId: 'not-requested' },
      ],
    ],
  ])('rejects %s result IDs', async (_case, returnedResults) => {
    const { service } = fixture((batch) => ({ results: returnedResults(batch) }));
    await expect(
      service.gradeBatch({
        items: items(2),
        language: 'English',
        openAnswerCount: 2,
        cacheHits: 0,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' } satisfies Partial<AIProviderError>);
  });

  it('uses token-aware multi-batch grading without adding concurrency', async () => {
    const largeItems = items(3, 300_000);
    expect(tokenAwareGradingBatches(largeItems, 200_000)).toHaveLength(2);
    const { service, generateStructured } = fixture();
    await service.gradeBatch({
      items: largeItems,
      language: 'English',
      openAnswerCount: 3,
      cacheHits: 0,
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.invocationCallOrder[0]).toBeLessThan(
      generateStructured.mock.invocationCallOrder[1]!,
    );
  });

  it('shares an in-flight identical grading batch', async () => {
    const fixtureState = fixture();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixtureState.generateStructured.mockImplementationOnce(async ({ messages }) => {
      await wait;
      const payload = JSON.parse(messages[1].content) as {
        gradingItems: OpenAnswerGradingItem[];
      };
      return {
        data: { results: resultFor(payload.gradingItems) },
        model: 'gemini-3.5-flash',
        providerRequests: 1,
      };
    });
    const input = { items: items(5), language: 'English', openAnswerCount: 5, cacheHits: 0 };
    const first = fixtureState.service.gradeBatch(input);
    const second = fixtureState.service.gradeBatch(input);
    await vi.waitFor(() => expect(fixtureState.generateStructured).toHaveBeenCalledTimes(1));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(fixtureState.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('includes provider structured-output correction attempts in Gemini request telemetry', async () => {
    const fixtureState = fixture();
    fixtureState.generateStructured.mockImplementationOnce(async ({ messages }) => {
      const payload = JSON.parse(messages[1].content) as {
        gradingItems: OpenAnswerGradingItem[];
      };
      return {
        data: { results: resultFor(payload.gradingItems) },
        model: 'gemini-3.5-flash',
        providerRequests: 2,
      };
    });
    await fixtureState.service.gradeBatch({
      items: items(2),
      language: 'English',
      openAnswerCount: 2,
      cacheHits: 0,
    });
    expect(writeAiTelemetry).toHaveBeenCalledWith(
      'info',
      'AI generation action',
      expect.objectContaining({
        feature: 'OPEN_ANSWER_GRADING',
        geminiRequests: 2,
        batchCount: 1,
        cacheHits: 0,
        cacheMisses: 2,
        outcome: 'completed',
      }),
    );
  });
});

describe('stableGradingKey', () => {
  const base = {
    attemptId: 'attempt-1',
    item: items(1)[0]!,
    model: 'gemini-3.5-flash',
    language: 'English',
  };

  it('is stable for identical grading inputs', () => {
    expect(stableGradingKey(base)).toBe(stableGradingKey(base));
  });

  it('invalidates when the answer or rubric changes', () => {
    const original = stableGradingKey(base);
    expect(
      stableGradingKey({
        ...base,
        item: { ...base.item, studentAnswer: 'A revised student answer' },
      }),
    ).not.toBe(original);
    expect(
      stableGradingKey({
        ...base,
        item: { ...base.item, expectedAnswer: 'A revised grading rubric' },
      }),
    ).not.toBe(original);
  });
});
