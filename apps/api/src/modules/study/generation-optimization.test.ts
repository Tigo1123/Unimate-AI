import { describe, expect, it } from 'vitest';
import {
  estimatedInputTokens,
  generationBatchTokenBudget,
  stableGenerationKey,
  tokenAwareBatches,
} from './generation-optimization.js';

const chunks = (tokens: number[]) =>
  tokens.map((tokenCount, index) => ({
    id: `chunk-${index}`,
    sourceId: 'source-1',
    chunkIndex: index,
    content: 'x'.repeat(tokenCount * 4),
    tokenCount,
  }));

describe('generation request optimization', () => {
  it('combines all chunks that safely fit the token budget', () => {
    expect(tokenAwareBatches(chunks([10_000, 20_000, 30_000]))).toHaveLength(1);
  });

  it('uses the large verified budget only for the configured Gemini model', () => {
    expect(generationBatchTokenBudget('gemini', 'gemini-3.5-flash')).toBe(200_000);
    expect(generationBatchTokenBudget('groq', 'some-model')).toBe(24_000);
    expect(generationBatchTokenBudget('gemini', 'unknown-model')).toBe(24_000);
  });

  it('uses the minimum ordered batches under the configured token budget', () => {
    const result = tokenAwareBatches(chunks([80_000, 80_000, 80_000]), 200_000);
    expect(result.map((batch) => batch.map((chunk) => chunk.chunkIndex))).toEqual([[0, 1], [2]]);
  });

  it('changes the cache key when source content or parameters change', () => {
    const base = {
      userId: 'user-1',
      courseId: 'course-1',
      feature: 'SUMMARY',
      model: 'gemini-3.5-flash',
      language: 'English',
      parameters: { type: 'SHORT' },
      chunks: chunks([100]),
    };
    const first = stableGenerationKey(base);
    expect(stableGenerationKey(base)).toBe(first);
    expect(
      stableGenerationKey({
        ...base,
        chunks: [{ ...base.chunks[0]!, content: `${base.chunks[0]!.content} changed` }],
      }),
    ).not.toBe(first);
    expect(stableGenerationKey({ ...base, parameters: { type: 'DETAILED' } })).not.toBe(first);
    expect(
      stableGenerationKey({
        ...base,
        parameters: { ...base.parameters, promptVersion: 'summary-v-next' },
      }),
    ).not.toBe(first);
    expect(estimatedInputTokens(base.chunks)).toBeGreaterThan(2_000);
  });
});
