import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { useTranslation } from '../i18n';
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-[40vh] place-items-center text-slate-500">{t('common.loading')}</div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
      <h3 className="font-semibold">{title}</h3>
      {children && (
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{children}</div>
      )}
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const rateLimited = error instanceof ApiError && error.code === 'AI_RATE_LIMITED';
  return error ? (
    <div
      role="alert"
      aria-live="assertive"
      className={
        rateLimited
          ? 'my-4 rounded-2xl border-2 border-red-500 bg-red-100 p-5 text-base font-semibold text-red-950 shadow-lg dark:border-red-400 dark:bg-red-950 dark:text-red-100'
          : 'rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300'
      }
    >
      {rateLimited ? <strong className="mb-1 block text-lg">{t('error.aiPaused')}</strong> : null}
      <span>{error instanceof Error ? error.message : t('error.generic')}</span>
      {error instanceof ApiError && error.requestId ? (
        <span className="mt-2 block text-xs font-normal opacity-80">
          {t('error.requestId', { id: error.requestId })}
        </span>
      ) : null}
    </div>
  ) : null;
}
