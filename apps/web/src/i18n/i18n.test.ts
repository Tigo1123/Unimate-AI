import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLanguage, preferredLanguage } from './index';

const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    },
  });
});

describe('UI language preference', () => {
  it('defaults to English and restores Arabic', () => {
    expect(preferredLanguage()).toBe('en');
    values.set('unimateLanguage', 'ar');
    expect(preferredLanguage()).toBe('ar');
  });

  it('applies language and direction to the document root', () => {
    const root = { lang: '', dir: '' };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: root },
    });
    applyLanguage('ar');
    expect(root).toEqual({ lang: 'ar', dir: 'rtl' });
    applyLanguage('en');
    expect(root).toEqual({ lang: 'en', dir: 'ltr' });
  });
});
