import { describe, expect, it } from 'vitest';
import { quizOutputSchema, summaryOutputSchema } from './generation.schemas.js';

describe('structured generation schemas', () => {
  it('rejects malformed quizzes', () => {
    expect(() =>
      quizOutputSchema.parse({
        questions: [
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Question?',
            options: [],
            correctAnswer: '',
            explanation: '',
            difficulty: 'EASY',
            topic: 'Topic',
            sourceChunkIndex: -1,
          },
        ],
      }),
    ).toThrow();
  });
  it('accepts a meaningful summary', () => {
    expect(
      summaryOutputSchema.parse({
        title: 'Normalization',
        content: 'A sufficiently detailed normalization summary.',
      }).title,
    ).toBe('Normalization');
  });
});
