import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ar } from './ar';
import { en } from './en';

export type Language = 'en' | 'ar';
const STORAGE_KEY = 'unimateLanguage';
const resources: Record<Language, unknown> = { en, ar };

export function preferredLanguage(): Language {
  if (typeof localStorage === 'undefined') return 'en';
  return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}

export function applyLanguage(language: Language) {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
}

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
};
function lookup(language: Language, key: string) {
  let value: unknown = resources[language];
  for (const part of key.split('.')) value = (value as Record<string, unknown> | undefined)?.[part];
  return typeof value === 'string' ? value : key;
}

function translate(language: Language, key: string, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce(
    (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
    lookup(language, key),
  );
}

const I18nContext = createContext<I18nValue>({
  language: 'en',
  setLanguage: () => undefined,
  t: (key, values) => translate('en', key, values),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>(() => preferredLanguage());
  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage(next) {
        localStorage.setItem(STORAGE_KEY, next);
        applyLanguage(next);
        updateLanguage(next);
      },
      t: (key, values) => translate(language, key, values),
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  return useContext(I18nContext);
}

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { language, setLanguage, t } = useTranslation();
  return (
    <button
      type="button"
      className={`btn-secondary size-10 p-0 ${className}`}
      aria-label={t('language.switchTo')}
      title={t('language.switchTo')}
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
    >
      <span className="text-xs font-bold">{t('language.short')}</span>
    </button>
  );
}
