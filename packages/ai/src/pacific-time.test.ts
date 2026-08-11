import { describe, expect, it } from 'vitest';
import { nextPacificMidnight, pacificRangeStart } from './index.js';

describe('Pacific quota-day boundaries', () => {
  it('uses midnight Pacific for ordinary quota days', () => {
    expect(nextPacificMidnight(new Date('2026-08-09T18:00:00.000Z')).toISOString()).toBe(
      '2026-08-10T07:00:00.000Z',
    );
    expect(pacificRangeStart(new Date('2026-08-09T18:00:00.000Z'), 1).toISOString()).toBe(
      '2026-08-09T07:00:00.000Z',
    );
  });

  it('handles the 23-hour spring DST quota day', () => {
    const start = new Date('2026-03-08T08:00:00.000Z');
    const reset = nextPacificMidnight(start);
    expect(reset.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(reset.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('handles the 25-hour autumn DST quota day', () => {
    const start = new Date('2026-11-01T07:00:00.000Z');
    const reset = nextPacificMidnight(start);
    expect(reset.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(reset.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });
});
