import { describe, expect, it, vi } from 'vitest';
import { claimAttemptForGrading, reusableOpenAnswerGrade } from './quiz-submission.js';

describe('claimAttemptForGrading', () => {
  it('allows only one of two simultaneous duplicate submissions to grade', async () => {
    let status: 'IN_PROGRESS' | 'GRADING' = 'IN_PROGRESS';
    const updateMany = vi.fn().mockImplementation(async ({ where, data }) => {
      await Promise.resolve();
      if (where.status !== status) return { count: 0 };
      status = data.status;
      return { count: 1 };
    });
    const store = { quizAttempt: { updateMany } };
    const input = { attemptId: 'attempt-1', userId: 'user-1' };
    const outcomes = await Promise.allSettled([
      claimAttemptForGrading(store, input),
      claimAttemptForGrading(store, input),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('reusableOpenAnswerGrade', () => {
  const answer = {
    gradingKey: 'current-key',
    isCorrect: true,
    scorePercent: 85,
    feedback: 'The core idea is correct.',
    gradingMissed: ['A supporting detail'],
  };

  it('reuses a complete grade only when its stable key matches', () => {
    expect(reusableOpenAnswerGrade(answer, 'current-key')).toEqual({
      isCorrect: true,
      scorePercent: 85,
      feedback: 'The core idea is correct.',
      missed: ['A supporting detail'],
    });
    expect(reusableOpenAnswerGrade(answer, 'changed-answer-or-rubric-key')).toBeNull();
  });
});
