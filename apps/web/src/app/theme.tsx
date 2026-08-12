import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../i18n';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'unimateTheme';

export function preferredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function initializeTheme() {
  applyTheme(preferredTheme());
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(() => preferredTheme());
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    setTheme(next);
  }
  return (
    <button
      aria-label={t(theme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark')}
      className={`btn-secondary size-10 p-0 ${className}`}
      onClick={toggle}
      title={t(theme === 'dark' ? 'theme.switchToLight' : 'theme.switchToDark')}
      type="button"
    >
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
