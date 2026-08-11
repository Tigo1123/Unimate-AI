import { describe, expect, it } from 'vitest';
import {
  conversationAwareRetrievalQuery,
  hasSufficientQuestionEvidence,
  hybridRerank,
} from '../rag-context.js';
import {
  entrepreneurshipEvaluationCases,
  entrepreneurshipQualityChunks,
} from './entrepreneurship.fixture.js';
import { educationalQualityRubric, retrievalReadinessScore } from './educational-quality.js';

describe('deterministic Entrepreneurship educational-quality evaluation', () => {
  it('defines every requested 0-5 rubric dimension', () => {
    expect(Object.keys(educationalQualityRubric)).toEqual([
      'grounding',
      'correctness',
      'coverage',
      'relevance',
      'clarity',
      'pedagogy',
      'structure',
      'sourceTraceability',
      'languageQuality',
      'hallucinationResistance',
    ]);
  });

  it.each(entrepreneurshipEvaluationCases)(
    '$id retrieves its real expected evidence or rejects missing material',
    (evaluation) => {
      const ranked = hybridRerank(evaluation.query, entrepreneurshipQualityChunks);
      const sufficient = hasSufficientQuestionEvidence(ranked);
      const selected = sufficient ? ranked.slice(0, 8).map((chunk) => chunk.chunkIndex) : [];
      const score = retrievalReadinessScore({
        expectedChunkIndexes: evaluation.expectedChunkIndexes,
        selectedChunkIndexes: selected,
        missingExpected: 'missing' in evaluation && evaluation.missing,
        evidenceSufficient: sufficient,
      });
      if ('missing' in evaluation && evaluation.missing) {
        expect(selected).toEqual([]);
        expect(score.hallucinationResistance).toBe(5);
      } else {
        expect(selected).toEqual(expect.arrayContaining([...evaluation.expectedChunkIndexes]));
        expect(score.grounding).toBe(5);
        expect(score.coverage).toBe(5);
      }
    },
  );

  it('resolves an ambiguous follow-up with the previous student question', () => {
    const resolved = conversationAwareRetrievalQuery('How are they different?', [
      { role: 'ASSISTANT', content: 'They differ by data source and cost.' },
      { role: 'USER', content: 'Compare primary and secondary market research.' },
    ]);
    expect(resolved).toContain('primary and secondary market research');
    const ranked = hybridRerank(resolved, entrepreneurshipQualityChunks);
    expect(ranked[0]?.chunkIndex).toBe(236);
  });
});
