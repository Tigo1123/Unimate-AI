import { describe, expect, it } from 'vitest';
import { aggregateAiUsage, type AiUsageRange } from './ai-usage.service.js';

const now = new Date('2026-08-09T18:00:00.000Z');

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    observedAt: new Date('2026-08-09T17:00:00.000Z'),
    event: 'AI generation action',
    feature: 'SUMMARY',
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    outcome: 'completed',
    status: null,
    providerRequests: 1,
    estimatedInputTokens: 1_200,
    batchCount: 1,
    synthesisRequestCount: 0,
    cacheStatus: 'MISS',
    cacheHits: null,
    cacheMisses: null,
    sharedBatches: null,
    openAnswerCount: null,
    totalLatencyMs: 2_000,
    metadata: { chunkCount: 20 },
    ...overrides,
  };
}

function quota(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
    quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
    quotaValue: 20,
    quotaDimensions: { model: 'gemini-3.5-flash', location: 'global' },
    rateLimitScope: 'DAY',
    observedAt: new Date('2026-08-09T16:00:00.000Z'),
    resetAt: new Date('2026-08-10T07:00:00.000Z'),
    ...overrides,
  };
}

function aggregate(
  events: ReturnType<typeof event>[],
  quotas: ReturnType<typeof quota>[] = [],
  range: AiUsageRange = 'today',
) {
  return aggregateAiUsage({
    events: events as never,
    quotas: quotas as never,
    range,
    now,
    currentProvider: 'gemini',
    currentModel: 'gemini-3.5-flash',
  });
}

describe('AI usage aggregation', () => {
  it('aggregates today and separates provider attempt outcomes', () => {
    const result = aggregate([
      event({ providerRequests: 2 }),
      event({ event: 'Gemini provider request completed', feature: null }),
      event({ event: 'Transient Gemini provider response', feature: null, status: 429 }),
    ]);
    expect(result.today).toMatchObject({
      actions: 1,
      actualRequests: 2,
      successfulProviderRequests: 1,
      failedProviderRequests: 1,
      rateLimitedRequests: 1,
      estimatedInputTokens: 1_200,
    });
  });

  it.each([
    ['7d', 7],
    ['30d', 30],
  ] as const)('returns complete %s daily history including empty days', (range, count) => {
    const result = aggregate([event()], [], range);
    expect(result.daily).toHaveLength(count);
    expect(result.daily.at(-1)?.actualRequests).toBe(1);
  });

  it('groups canonical features and computes defensible legacy savings', () => {
    const result = aggregate([
      event({ feature: 'CHAT_EXPLAIN', metadata: {}, providerRequests: 1 }),
      event({ feature: 'SUMMARY', metadata: { chunkCount: 25 }, providerRequests: 1 }),
      event({
        feature: 'OPEN_ANSWER_GRADING',
        metadata: {},
        openAnswerCount: 10,
        providerRequests: 1,
      }),
    ]);
    expect(result.features.find((item) => item.feature === 'CHAT')?.actions).toBe(1);
    expect(result.features.find((item) => item.feature === 'SUMMARY')).toMatchObject({
      actualRequests: 1,
      estimatedLegacyRequests: 4,
      estimatedRequestsSaved: 3,
    });
    expect(result.features.find((item) => item.feature === 'OPEN_ANSWER_GRADING')).toMatchObject({
      estimatedLegacyRequests: 10,
      estimatedRequestsSaved: 9,
    });
  });

  it('computes cache hit rate and cache/in-flight savings', () => {
    const result = aggregate([
      event({ cacheStatus: 'HIT', providerRequests: 0, metadata: {} }),
      event({ cacheStatus: 'MISS', providerRequests: 1, metadata: {} }),
      event({ cacheStatus: 'IN_FLIGHT', providerRequests: 0, metadata: {} }),
    ]);
    expect(result.cache).toEqual({ hits: 1, misses: 1, hitRate: 0.5 });
    expect(result.today.inFlightDeduplicatedActions).toBe(1);
    expect(result.savings.estimatedRequestsSaved).toBe(2);
  });

  it('returns unknown quota without inventing remaining usage', () => {
    const result = aggregate([event()]);
    expect(result.quota).toEqual({
      usage: { actualRequests: 1 },
      quota: { known: false },
      exhausted: false,
    });
    expect('estimatedRemaining' in result.quota).toBe(false);
  });

  it('uses provider-reported daily quota and estimates remaining locally', () => {
    const result = aggregate(
      [event({ providerRequests: 7 })],
      [quota({ observedAt: new Date('2026-08-08T16:00:00.000Z') })],
    );
    expect(result.quota).toMatchObject({
      usage: { actualRequests: 7 },
      quota: { known: true, limit: 20, scope: 'DAY' },
      estimatedRemaining: 13,
      exhausted: false,
    });
  });

  it('keeps model-specific quotas and denominators separate', () => {
    const result = aggregate(
      [event(), event({ model: 'gemini-other', providerRequests: 4 })],
      [quota(), quota({ model: 'gemini-other', quotaDimensions: { model: 'gemini-other' } })],
    );
    expect(result.quotas).toHaveLength(2);
    expect(result.quotas.find((item) => item.quota.model === 'gemini-3.5-flash')?.usage).toEqual({
      actualRequests: 1,
    });
    expect(result.quotas.find((item) => item.quota.model === 'gemini-other')?.usage).toEqual({
      actualRequests: 4,
    });
  });

  it('marks a provider-reported daily failure in the current quota day as exhausted', () => {
    const result = aggregate([event({ providerRequests: 20 })], [quota()]);
    expect(result.quota).toMatchObject({ exhausted: true, estimatedRemaining: 0 });
  });

  it('handles malformed optional telemetry and no-activity state safely', () => {
    const malformed = event({
      feature: null,
      providerRequests: null,
      estimatedInputTokens: null,
      metadata: {},
    });
    const result = aggregate([malformed]);
    expect(result.today.actions).toBe(0);
    expect(result.recent).toEqual([]);
    expect(result.daily).toEqual([expect.objectContaining({ actions: 0, actualRequests: 0 })]);
  });
});
