import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from '../i18n';

const STORAGE_KEY = 'unimateAiCooldownUntil';
const SCOPE_STORAGE_KEY = 'unimateAiCooldownScope';
const listeners = new Set<() => void>();
let cooldownUntil =
  typeof sessionStorage === 'undefined' ? 0 : Number(sessionStorage.getItem(STORAGE_KEY) ?? 0);
let cooldownScope: 'MINUTE' | 'DAY' | undefined =
  typeof sessionStorage === 'undefined'
    ? undefined
    : ((sessionStorage.getItem(SCOPE_STORAGE_KEY) as 'MINUTE' | 'DAY' | null) ?? undefined);

function emit() {
  for (const listener of listeners) listener();
}

export function startAiCooldown(
  retryAfterSeconds: number,
  rateLimitScope: 'MINUTE' | 'DAY' = 'MINUTE',
) {
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return;
  const candidate = Date.now() + Math.ceil(retryAfterSeconds * 1000);
  if (candidate >= cooldownUntil) {
    cooldownUntil = candidate;
    cooldownScope = rateLimitScope;
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(STORAGE_KEY, String(cooldownUntil));
    if (cooldownScope) sessionStorage.setItem(SCOPE_STORAGE_KEY, cooldownScope);
  }
  emit();
}

export function startAiCooldownUntil(
  deadline: string | number | Date,
  rateLimitScope: 'MINUTE' | 'DAY' = 'DAY',
) {
  const timestamp = new Date(deadline).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return;
  startAiCooldown((timestamp - Date.now()) / 1000, rateLimitScope);
}

export function clearExpiredAiCooldown(now = Date.now()) {
  if (cooldownUntil > now) return;
  cooldownUntil = 0;
  cooldownScope = undefined;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SCOPE_STORAGE_KEY);
  }
  emit();
}

export function aiCooldownDeadline() {
  return cooldownUntil;
}

export function formatAiCooldown(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiCooldown() {
  const deadline = useSyncExternalStore(subscribe, aiCooldownDeadline, () => 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline <= Date.now()) {
      clearExpiredAiCooldown();
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearExpiredAiCooldown(current);
    }, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const secondsRemaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return { coolingDown: secondsRemaining > 0, secondsRemaining, rateLimitScope: cooldownScope };
}

export function AiCooldownNotice() {
  const { t } = useTranslation();
  const { coolingDown, secondsRemaining, rateLimitScope } = useAiCooldown();
  if (!coolingDown) return null;
  return (
    <div
      className="sticky top-2 z-20 my-3 rounded-2xl border-2 border-red-500 bg-red-100 px-5 py-4 text-base font-bold text-red-950 shadow-lg dark:border-red-400 dark:bg-red-950 dark:text-red-100"
      role="status"
      aria-live="polite"
    >
      <span className="block text-lg">{t('cooldown.title')}</span>
      <span className="mt-1 block font-semibold">
        {rateLimitScope === 'DAY'
          ? t('cooldown.daily', { time: formatAiCooldown(secondsRemaining) })
          : t('cooldown.limited', { time: formatAiCooldown(secondsRemaining) })}
      </span>
    </div>
  );
}
