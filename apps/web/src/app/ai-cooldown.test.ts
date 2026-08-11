import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiCooldownDeadline,
  clearExpiredAiCooldown,
  formatAiCooldown,
  startAiCooldown,
  startAiCooldownUntil,
} from './ai-cooldown';

describe('shared AI cooldown', () => {
  afterEach(() => {
    clearExpiredAiCooldown(Number.POSITIVE_INFINITY);
    vi.useRealTimers();
  });

  it('shares the longest retry-after deadline and expires it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T09:00:00Z'));
    startAiCooldown(6);
    const firstDeadline = aiCooldownDeadline();
    expect(firstDeadline).toBe(Date.now() + 6_000);

    startAiCooldown(3);
    expect(aiCooldownDeadline()).toBe(firstDeadline);

    vi.advanceTimersByTime(6_000);
    clearExpiredAiCooldown();
    expect(aiCooldownDeadline()).toBe(0);
  });

  it('formats a daily cooldown without displaying tens of thousands of seconds', () => {
    expect(formatAiCooldown(55)).toBe('55s');
    expect(formatAiCooldown(79_075)).toBe('21h 58m');
  });

  it('uses the dashboard reset deadline in the same shared cooldown store', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T18:00:00Z'));
    startAiCooldownUntil('2026-08-10T07:00:00Z', 'DAY');
    expect(aiCooldownDeadline()).toBe(new Date('2026-08-10T07:00:00Z').getTime());
  });
});
