import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preferredTheme } from './theme';

const { preferences } = vi.hoisted(() => {
  const preferences = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => preferences.get(key) ?? null,
      setItem: (key: string, value: string) => preferences.set(key, value),
      removeItem: (key: string) => preferences.delete(key),
    },
  });
  return { preferences };
});

describe('theme preference', () => {
  beforeEach(() => preferences.clear());

  it('defaults to dark when the user has no saved preference', () => {
    expect(preferredTheme()).toBe('dark');
  });

  it('respects a saved light preference', () => {
    localStorage.setItem('unimateTheme', 'light');
    expect(preferredTheme()).toBe('light');
  });
});
