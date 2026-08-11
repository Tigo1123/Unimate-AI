import type { AiQuotaObservation, AiTelemetryEvent, PrismaClient } from '@prisma/client';
import { nextPacificMidnight, pacificDateParts, pacificRangeStart } from '@unimate/ai';

export type AiUsageRange = 'today' | '7d' | '30d';
type Event = Pick<
  AiTelemetryEvent,
  | 'id'
  | 'observedAt'
  | 'event'
  | 'feature'
  | 'provider'
  | 'model'
  | 'outcome'
  | 'status'
  | 'providerRequests'
  | 'estimatedInputTokens'
  | 'batchCount'
  | 'synthesisRequestCount'
  | 'cacheStatus'
  | 'cacheHits'
  | 'cacheMisses'
  | 'sharedBatches'
  | 'openAnswerCount'
  | 'totalLatencyMs'
  | 'metadata'
>;
type Quota = Pick<
  AiQuotaObservation,
  | 'provider'
  | 'model'
  | 'quotaId'
  | 'quotaMetric'
  | 'quotaValue'
  | 'quotaDimensions'
  | 'rateLimitScope'
  | 'observedAt'
  | 'resetAt'
>;

const FEATURE_ORDER = [
  'CHAT',
  'EXPLAIN',
  'SUMMARY',
  'FLASHCARDS',
  'EXAM_QUESTIONS',
  'OPEN_ANSWER_GRADING',
];

function canonicalFeature(feature: string) {
  if (feature.startsWith('CHAT_')) return 'CHAT';
  if (feature === 'CREATE_EXAM_QUESTIONS') return 'EXAM_QUESTIONS';
  return feature;
}

function isAction(event: Event) {
  return Boolean(
    event.feature &&
    (event.event === 'AI generation action' || event.event === 'RAG request timing'),
  );
}

function metadataNumber(event: Event, field: string) {
  const metadata = event.metadata as Record<string, unknown>;
  const number = Number(metadata[field]);
  return Number.isFinite(number) ? number : 0;
}

function legacyRequestEstimate(event: Event) {
  const feature = canonicalFeature(event.feature!);
  if (feature === 'OPEN_ANSWER_GRADING') return Math.max(0, event.openAnswerCount ?? 0);
  if (feature === 'SUMMARY' || feature === 'EXPLAIN') {
    const chunkCount = metadataNumber(event, 'chunkCount');
    if (chunkCount > 0) {
      const batches = Math.ceil(chunkCount / 10);
      return batches + (batches > 1 ? 1 : 0);
    }
  }
  if (event.cacheStatus === 'HIT' || event.cacheStatus === 'IN_FLIGHT') return 1;
  return Math.max(1, event.providerRequests ?? 0);
}

function pacificDayKey(date: Date) {
  const value = pacificDateParts(date);
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function dayKeys(now: Date, count: number) {
  const today = pacificDateParts(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day - (count - index - 1)));
    return date.toISOString().slice(0, 10);
  });
}

function actionMetrics(events: Event[]) {
  const actualRequests = events.reduce((sum, event) => sum + (event.providerRequests ?? 0), 0);
  const estimatedLegacyRequests = events.reduce(
    (sum, event) => sum + legacyRequestEstimate(event),
    0,
  );
  const cacheHits = events.reduce(
    (sum, event) => sum + (event.cacheHits ?? (event.cacheStatus === 'HIT' ? 1 : 0)),
    0,
  );
  const cacheMisses = events.reduce(
    (sum, event) => sum + (event.cacheMisses ?? (event.cacheStatus === 'MISS' ? 1 : 0)),
    0,
  );
  const totalLatencyMs = events.reduce((sum, event) => sum + (event.totalLatencyMs ?? 0), 0);
  return {
    actions: events.length,
    actualRequests,
    estimatedInputTokens: events.reduce((sum, event) => sum + (event.estimatedInputTokens ?? 0), 0),
    cacheHits,
    cacheMisses,
    inFlightDeduplicatedActions: events.reduce(
      (sum, event) =>
        sum + (event.cacheStatus === 'IN_FLIGHT' ? 1 : 0) + (event.sharedBatches ?? 0),
      0,
    ),
    batchCount: events.reduce((sum, event) => sum + (event.batchCount ?? 0), 0),
    synthesisRequestCount: events.reduce(
      (sum, event) => sum + (event.synthesisRequestCount ?? 0),
      0,
    ),
    totalLatencyMs,
    averageLatencyMs: events.length ? Math.round(totalLatencyMs / events.length) : 0,
    failures: events.filter((event) => event.outcome === 'failed').length,
    estimatedLegacyRequests,
    estimatedRequestsSaved: Math.max(0, estimatedLegacyRequests - actualRequests),
  };
}

export function aggregateAiUsage(input: {
  events: Event[];
  quotas: Quota[];
  range: AiUsageRange;
  now?: Date;
  currentProvider: string;
  currentModel: string;
}) {
  const now = input.now ?? new Date();
  const days = input.range === 'today' ? 1 : input.range === '7d' ? 7 : 30;
  const actions = input.events.filter(isAction);
  const todayStart = pacificRangeStart(now, 1);
  const todayActions = actions.filter((event) => event.observedAt >= todayStart);
  const todayProviderEvents = input.events.filter((event) => event.observedAt >= todayStart);
  const successfulProviderRequests = todayProviderEvents.filter(
    (event) => event.event === 'Gemini provider request completed',
  ).length;
  const failedProviderRequests = todayProviderEvents.filter(
    (event) =>
      event.event === 'Transient Gemini provider response' ||
      event.event === 'Gemini provider request failed',
  ).length;
  const todayActionMetrics = actionMetrics(todayActions);
  const today = {
    ...todayActionMetrics,
    actualRequests: Math.max(
      todayActionMetrics.actualRequests,
      successfulProviderRequests + failedProviderRequests,
    ),
    successfulProviderRequests,
    failedProviderRequests,
    rateLimitedRequests: todayProviderEvents.filter(
      (event) => event.event === 'Transient Gemini provider response' && event.status === 429,
    ).length,
  };

  const grouped = new Map<string, Event[]>();
  for (const event of actions) {
    const feature = canonicalFeature(event.feature!);
    grouped.set(feature, [...(grouped.get(feature) ?? []), event]);
  }
  const features = [...new Set([...FEATURE_ORDER, ...grouped.keys()])].map((feature) => ({
    feature,
    ...actionMetrics(grouped.get(feature) ?? []),
  }));

  const dailyMap = new Map<string, Event[]>();
  for (const event of actions) {
    const key = pacificDayKey(event.observedAt);
    dailyMap.set(key, [...(dailyMap.get(key) ?? []), event]);
  }
  const providerAttemptsByDay = new Map<string, number>();
  for (const event of input.events) {
    if (
      event.event !== 'Gemini provider request completed' &&
      event.event !== 'Transient Gemini provider response' &&
      event.event !== 'Gemini provider request failed'
    )
      continue;
    const key = pacificDayKey(event.observedAt);
    providerAttemptsByDay.set(key, (providerAttemptsByDay.get(key) ?? 0) + 1);
  }
  const daily = dayKeys(now, days).map((date) => {
    const metrics = actionMetrics(dailyMap.get(date) ?? []);
    return {
      date,
      ...metrics,
      actualRequests: Math.max(metrics.actualRequests, providerAttemptsByDay.get(date) ?? 0),
    };
  });

  const latestQuotas = new Map<string, Quota>();
  for (const quota of [...input.quotas].sort(
    (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
  )) {
    const dimensions = JSON.stringify(quota.quotaDimensions);
    const key = `${quota.provider}:${quota.model}:${quota.quotaId}:${dimensions}`;
    if (!latestQuotas.has(key)) latestQuotas.set(key, quota);
  }
  const quotas = [...latestQuotas.values()].map((quota) => {
    const matchingToday = todayActions.filter(
      (event) => event.provider === quota.provider && event.model === quota.model,
    );
    const actualRequests = matchingToday.reduce(
      (sum, event) => sum + (event.providerRequests ?? 0),
      0,
    );
    const matchingProviderAttempts = todayProviderEvents.filter(
      (event) =>
        event.provider === quota.provider &&
        event.model === quota.model &&
        (event.event === 'Gemini provider request completed' ||
          event.event === 'Transient Gemini provider response' ||
          event.event === 'Gemini provider request failed'),
    ).length;
    const observedRequests = Math.max(actualRequests, matchingProviderAttempts);
    const limit = quota.quotaValue ?? undefined;
    const dailyScope = quota.rateLimitScope === 'DAY';
    const resetAt = dailyScope ? nextPacificMidnight(now) : quota.resetAt;
    const observedThisQuotaDay = quota.observedAt >= todayStart;
    return {
      usage: { actualRequests: observedRequests },
      quota: {
        known: limit !== undefined,
        source: 'PROVIDER_QUOTA_FAILURE' as const,
        ...(limit !== undefined ? { limit } : {}),
        scope: quota.rateLimitScope,
        provider: quota.provider,
        model: quota.model,
        quotaId: quota.quotaId,
        quotaMetric: quota.quotaMetric,
        quotaDimensions: quota.quotaDimensions,
        observedAt: quota.observedAt.toISOString(),
        resetAt: resetAt?.toISOString(),
        remainingDurationMs: resetAt ? Math.max(0, resetAt.getTime() - now.getTime()) : undefined,
      },
      estimatedRemaining:
        limit !== undefined ? Math.max(0, Math.floor(limit - observedRequests)) : undefined,
      exhausted: dailyScope && observedThisQuotaDay,
    };
  });
  const currentQuota = quotas.find(
    (item) =>
      item.quota.provider === input.currentProvider && item.quota.model === input.currentModel,
  ) ?? {
    usage: {
      actualRequests: todayActions
        .filter(
          (event) => event.provider === input.currentProvider && event.model === input.currentModel,
        )
        .reduce((sum, event) => sum + (event.providerRequests ?? 0), 0),
    },
    quota: { known: false as const },
    exhausted: false,
  };

  return {
    range: input.range,
    generatedAt: now.toISOString(),
    rangeStart: pacificRangeStart(now, days).toISOString(),
    rangeEnd: now.toISOString(),
    scope: 'PROJECT' as const,
    today,
    savings: {
      actualRequests: actionMetrics(actions).actualRequests,
      estimatedLegacyRequests: actionMetrics(actions).estimatedLegacyRequests,
      estimatedRequestsSaved: actionMetrics(actions).estimatedRequestsSaved,
      methodology:
        'Legacy requests are estimated only from recorded cache/deduplication, prior 10-chunk generation batching, and prior per-open-answer grading behavior.',
    },
    cache: {
      hits: actionMetrics(actions).cacheHits,
      misses: actionMetrics(actions).cacheMisses,
      hitRate:
        actionMetrics(actions).cacheHits + actionMetrics(actions).cacheMisses
          ? actionMetrics(actions).cacheHits /
            (actionMetrics(actions).cacheHits + actionMetrics(actions).cacheMisses)
          : 0,
    },
    features,
    daily,
    quota: currentQuota,
    quotas,
    recent: actions
      .slice()
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
      .slice(0, 20)
      .map((event) => ({
        id: event.id,
        feature: canonicalFeature(event.feature!),
        provider: event.provider,
        model: event.model,
        requests: event.providerRequests ?? 0,
        cacheStatus: event.cacheStatus,
        batchCount: event.batchCount ?? 0,
        estimatedInputTokens: event.estimatedInputTokens ?? 0,
        latencyMs: event.totalLatencyMs ?? 0,
        outcome: event.outcome ?? 'unknown',
        observedAt: event.observedAt.toISOString(),
      })),
    accuracyNote:
      'Estimated remaining uses locally observed requests. Requests made by other deployments or processes using the same provider project may not appear here.',
  };
}

export class AiUsageService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly currentProvider: string,
    private readonly currentModel: string,
  ) {}

  async dashboard(range: AiUsageRange, now = new Date()) {
    const days = range === 'today' ? 1 : range === '7d' ? 7 : 30;
    const [events, quotas] = await Promise.all([
      this.prisma.aiTelemetryEvent.findMany({
        where: { observedAt: { gte: pacificRangeStart(now, days), lte: now } },
        orderBy: { observedAt: 'asc' },
      }),
      this.prisma.aiQuotaObservation.findMany({ orderBy: { observedAt: 'desc' }, take: 100 }),
    ]);
    return aggregateAiUsage({
      events,
      quotas,
      range,
      now,
      currentProvider: this.currentProvider,
      currentModel: this.currentModel,
    });
  }
}
