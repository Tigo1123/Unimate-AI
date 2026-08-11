import { describe, expect, it } from 'vitest';
import { calculateMastery } from './mastery.js';

describe('calculateMastery', () => {
  it('calculates a percentage', () => expect(calculateMastery(3, 4)).toBe(75));
  it('handles no questions without NaN', () => expect(calculateMastery(0, 0)).toBe(0));
  it('rejects impossible counts', () => expect(() => calculateMastery(2, 1)).toThrow());
});
