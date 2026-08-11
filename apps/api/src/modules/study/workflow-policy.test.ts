import { describe, expect, it } from 'vitest';
import { actionOutputTokens, finishChatContent, providerOutputTokens } from './rag-chat.service.js';

describe('shared study workflow output policy', () => {
  it('defines sufficient budgets for every study action', () => {
    expect(actionOutputTokens).toEqual({
      EXPLAIN: 2600,
      SUMMARIZE: 1800,
      CREATE_EXAM_QUESTIONS: 2600,
      STUDY_FIRST: 2200,
      SIMPLIFY: 1600,
      EXAM_PREP: 2600,
    });
  });

  it('never exposes a provider-length cutoff as a partial sentence', () => {
    expect(
      finishChatContent(
        'First point is complete. Triple Bottom Line means profit, people, and',
        'length',
      ),
    ).toBe(
      "First point is complete.\n\n> Response shortened at the provider's output limit. Ask for a continuation if you need more detail.",
    );
  });

  it('reserves Gemini thinking space without increasing other provider budgets', () => {
    expect(providerOutputTokens('STUDY_FIRST', 'gemini')).toBe(4400);
    expect(providerOutputTokens('STUDY_FIRST', 'groq')).toBe(2200);
    expect(providerOutputTokens('SUMMARIZE', 'openai')).toBe(1800);
  });

  it('does not alter normally completed content', () => {
    expect(finishChatContent('Complete answer.', 'stop')).toBe('Complete answer.');
  });
});
