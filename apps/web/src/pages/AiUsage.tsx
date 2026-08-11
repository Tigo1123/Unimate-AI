import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  ServerCog,
  Sparkles,
  Zap,
} from 'lucide-react';
import { startAiCooldownUntil } from '../app/ai-cooldown';
import { ErrorBox, Loading } from '../components/ui';
import { api } from '../lib/api';

type Range = 'today' | '7d' | '30d';
type Metrics = {
  actions: number;
  actualRequests: number;
  estimatedInputTokens: number;
  cacheHits: number;
  cacheMisses: number;
  inFlightDeduplicatedActions: number;
  batchCount: number;
  synthesisRequestCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  failures: number;
  estimatedLegacyRequests: number;
  estimatedRequestsSaved: number;
};
type AiUsagePayload = {
  range: Range;
  generatedAt: string;
  scope: 'PROJECT';
  today: Metrics & {
    successfulProviderRequests: number;
    failedProviderRequests: number;
    rateLimitedRequests: number;
  };
  savings: {
    actualRequests: number;
    estimatedLegacyRequests: number;
    estimatedRequestsSaved: number;
    methodology: string;
  };
  cache: { hits: number; misses: number; hitRate: number };
  features: Array<Metrics & { feature: string }>;
  daily: Array<Metrics & { date: string }>;
  quota: {
    usage: { actualRequests: number };
    quota: {
      known: boolean;
      source?: 'PROVIDER_QUOTA_FAILURE';
      limit?: number;
      scope?: string;
      provider?: string;
      model?: string;
      quotaId?: string;
      observedAt?: string;
      resetAt?: string;
      remainingDurationMs?: number;
    };
    estimatedRemaining?: number;
    exhausted: boolean;
  };
  recent: Array<{
    id: string;
    feature: string;
    provider?: string | null;
    model?: string | null;
    requests: number;
    cacheStatus?: string | null;
    batchCount: number;
    estimatedInputTokens: number;
    latencyMs: number;
    outcome: string;
    observedAt: string;
  }>;
  accuracyNote: string;
};

const number = new Intl.NumberFormat();
const featureLabels: Record<string, string> = {
  CHAT: 'Chat',
  EXPLAIN: 'Explain',
  SUMMARY: 'Summary',
  FLASHCARDS: 'Flashcards',
  EXAM_QUESTIONS: 'Exam generation',
  OPEN_ANSWER_GRADING: 'Open-answer grading',
};

function duration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
}

function remainingDuration(milliseconds?: number) {
  if (!milliseconds) return 'Unavailable';
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.ceil((milliseconds % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function quotaState(used: number, limit?: number) {
  if (!limit) return { label: 'Quota unavailable', tone: 'slate', percent: 0 };
  const percent = (used / limit) * 100;
  if (percent >= 100) return { label: 'Exhausted', tone: 'red', percent };
  if (percent >= 85) return { label: 'Critical', tone: 'red', percent };
  if (percent >= 60) return { label: 'Warning', tone: 'amber', percent };
  return { label: 'Safe', tone: 'green', percent };
}

function StatCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <span className="rounded-xl bg-brand-50 p-2.5 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">
          <Icon size={20} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
    </section>
  );
}

export function AiUsageDashboardView({
  data,
  isLoading,
  error,
  range,
  onRangeChange,
}: {
  data?: AiUsagePayload;
  isLoading: boolean;
  error?: unknown;
  range: Range;
  onRangeChange(range: Range): void;
}) {
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <ErrorBox error={new Error('AI usage data is unavailable.')} />;
  const quota = data.quota;
  const state = quotaState(quota.usage.actualRequests, quota.quota.limit);
  const selectedTokens = data.features.reduce(
    (sum, feature) => sum + feature.estimatedInputTokens,
    0,
  );
  const maxDaily = Math.max(1, ...data.daily.map((day) => day.actualRequests));
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
            <ServerCog size={17} /> Project-wide administrator view
          </div>
          <h1 className="text-3xl font-bold">AI usage &amp; quota</h1>
          <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">
            Provider consumption, quota pressure, and the requests avoided by batching, caching, and
            deduplication.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(['today', '7d', '30d'] as const).map((value) => (
            <button
              key={value}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${range === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              onClick={() => onRangeChange(value)}
            >
              {value === 'today' ? 'Today' : value === '7d' ? '7 days' : '30 days'}
            </button>
          ))}
        </div>
      </header>

      {quota.exhausted ? (
        <section className="rounded-2xl border-2 border-red-500 bg-red-50 p-5 text-red-950 dark:border-red-400 dark:bg-red-950 dark:text-red-100">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <AlertTriangle aria-hidden="true" /> Daily AI quota reached
          </h2>
          <p className="mt-1 font-medium">
            Generation is unavailable until the midnight-Pacific reset. Reset in{' '}
            {remainingDuration(quota.quota.remainingDurationMs)}.
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-4">
        <section className="card xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                AI requests today
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight">
                {quota.usage.actualRequests}
                {quota.quota.known ? (
                  <span className="text-2xl text-slate-500 dark:text-slate-400">
                    {' '}
                    / {quota.quota.limit}
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {quota.quota.known
                  ? quota.exhausted
                    ? `${quota.estimatedRemaining ?? 0} locally estimated remaining, but Gemini reported exhaustion`
                    : `${quota.estimatedRemaining ?? 0} estimated remaining`
                  : 'Provider-reported quota limit is unavailable'}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${state.tone === 'red' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : state.tone === 'amber' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : state.tone === 'green' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
            >
              {state.label}
            </span>
          </div>
          <div
            className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar"
            aria-label="Daily AI request quota used"
            aria-valuemin={0}
            aria-valuemax={quota.quota.limit ?? undefined}
            aria-valuenow={quota.quota.known ? quota.usage.actualRequests : undefined}
          >
            <div
              className={`h-full rounded-full ${state.tone === 'red' ? 'bg-red-600' : state.tone === 'amber' ? 'bg-amber-500' : 'bg-brand-600'}`}
              style={{ width: `${Math.min(100, state.percent)}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {quota.quota.known ? 'Limit reported by Gemini in a quota failure' : 'No known limit'}
            </span>
            <span>Reset in {remainingDuration(quota.quota.remainingDurationMs)}</span>
          </div>
          {quota.quota.model ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {quota.quota.provider} · {quota.quota.model}
            </p>
          ) : null}
        </section>
        <StatCard
          icon={Zap}
          title="Requests saved"
          value={number.format(data.savings.estimatedRequestsSaved)}
          detail={`${number.format(data.savings.actualRequests)} actual · ${number.format(data.savings.estimatedLegacyRequests)} estimated legacy`}
        />
        <StatCard
          icon={Layers3}
          title="Cache hit rate"
          value={`${Math.round(data.cache.hitRate * 100)}%`}
          detail={`${number.format(data.cache.hits)} hits · ${number.format(data.cache.misses)} misses`}
        />
        <StatCard
          icon={Sparkles}
          title="Estimated input tokens"
          value={number.format(selectedTokens)}
          detail="Locally estimated input size, not provider billing tokens"
        />
        <StatCard
          icon={Activity}
          title="AI actions"
          value={number.format(data.features.reduce((sum, feature) => sum + feature.actions, 0))}
          detail={`${data.features.reduce((sum, feature) => sum + feature.failures, 0)} failed actions`}
        />
        <StatCard
          icon={ServerCog}
          title="Provider attempts today"
          value={number.format(data.today.actualRequests)}
          detail={`${data.today.successfulProviderRequests} successful · ${data.today.failedProviderRequests} failed`}
        />
        <StatCard
          icon={Gauge}
          title="Average latency"
          value={duration(
            data.features.reduce((sum, feature) => sum + feature.totalLatencyMs, 0) /
              Math.max(
                1,
                data.features.reduce((sum, feature) => sum + feature.actions, 0),
              ),
          )}
          detail={`${number.format(data.today.rateLimitedRequests)} rate-limited provider attempts today`}
        />
        <StatCard
          icon={CheckCircle2}
          title="Deduplicated actions"
          value={number.format(
            data.features.reduce((sum, feature) => sum + feature.inFlightDeduplicatedActions, 0),
          )}
          detail={`${number.format(data.features.reduce((sum, feature) => sum + feature.batchCount, 0))} total batches`}
        />
      </div>

      <section className="card overflow-hidden p-0">
        <div className="border-b border-slate-200 p-5 dark:border-slate-800">
          <h2 className="text-lg font-bold">Feature breakdown</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Requests saved are estimates only where the recorded legacy execution strategy is
            defensible.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              <tr>
                {[
                  'Feature',
                  'Actions',
                  'Requests',
                  'Est. tokens',
                  'Cache hits',
                  'Saved',
                  'Avg. latency',
                  'Failures',
                ].map((heading) => (
                  <th className="px-5 py-3 font-semibold" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.features.map((feature) => (
                <tr key={feature.feature}>
                  <th className="px-5 py-4 font-semibold">
                    {featureLabels[feature.feature] ?? feature.feature.replaceAll('_', ' ')}
                  </th>
                  <td className="px-5 py-4">{number.format(feature.actions)}</td>
                  <td className="px-5 py-4">{number.format(feature.actualRequests)}</td>
                  <td className="px-5 py-4">{number.format(feature.estimatedInputTokens)}</td>
                  <td className="px-5 py-4">{number.format(feature.cacheHits)}</td>
                  <td className="px-5 py-4 font-semibold text-brand-700 dark:text-brand-300">
                    {number.format(feature.estimatedRequestsSaved)}
                  </td>
                  <td className="px-5 py-4">{duration(feature.averageLatencyMs)}</td>
                  <td className="px-5 py-4">{number.format(feature.failures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-bold">Daily Gemini requests</h2>
        <div className="mt-6 flex h-48 items-end gap-1.5" aria-label="Daily Gemini request history">
          {data.daily.map((day) => (
            <div
              className="group flex min-w-0 flex-1 flex-col items-center justify-end"
              key={day.date}
            >
              <span className="mb-1 text-xs font-semibold">{day.actualRequests || ''}</span>
              <div
                className="w-full min-w-1 rounded-t bg-brand-600 transition group-hover:bg-brand-700"
                style={{
                  height: `${day.actualRequests ? Math.max(5, (day.actualRequests / maxDaily) * 145) : 2}px`,
                }}
                title={`${day.date}: ${day.actualRequests} Gemini requests`}
              />
              {(data.daily.length <= 7 ||
                day.date.endsWith('-01') ||
                day === data.daily.at(-1)) && (
                <span className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                  {day.date.slice(5)}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden p-0">
        <div className="p-5">
          <h2 className="text-lg font-bold">Recent AI activity</h2>
        </div>
        {data.recent.length ? (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.recent.map((item) => (
              <li
                className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-sm"
                key={item.id}
              >
                <span className="min-w-40 font-semibold">
                  {featureLabels[item.feature] ?? item.feature.replaceAll('_', ' ')}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {item.provider ?? 'unknown provider'}
                  {item.model ? ` · ${item.model}` : ''}
                </span>
                <span>{item.requests} requests</span>
                <span>
                  {item.cacheStatus ? `cache ${item.cacheStatus.toLowerCase()}` : 'no cache'}
                </span>
                <span>{number.format(item.estimatedInputTokens)} est. tokens</span>
                <span>{item.batchCount} batches</span>
                <span>{duration(item.latencyMs)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.outcome === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}
                >
                  {item.outcome}
                </span>
                <time className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                  {new Date(item.observedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-slate-200 p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            No AI activity was recorded in this range.
          </p>
        )}
      </section>

      <footer className="flex gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        <Clock3 className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
        <span>
          {data.accuracyNote} Provider-reported limits are model- and dimension-specific.{' '}
          {data.savings.methodology}
        </span>
      </footer>
    </div>
  );
}

export function AiUsage() {
  const [range, setRange] = useState<Range>('today');
  const query = useQuery({
    queryKey: ['ai-usage', range],
    queryFn: () => api.get<AiUsagePayload>(`/ai-usage?range=${range}`),
  });
  useEffect(() => {
    const quota = query.data?.quota;
    if (quota?.exhausted && quota.quota.scope === 'DAY' && quota.quota.resetAt)
      startAiCooldownUntil(quota.quota.resetAt, 'DAY');
  }, [query.data]);
  return (
    <AiUsageDashboardView
      {...(query.data ? { data: query.data } : {})}
      isLoading={query.isLoading}
      error={query.error}
      range={range}
      onRangeChange={setRange}
    />
  );
}
