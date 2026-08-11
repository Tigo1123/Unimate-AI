import { AppError } from '../../shared/errors/app-error.js';

type AttemptStatusStore = {
  quizAttempt: {
    updateMany(input: {
      where: { id: string; userId?: string; status: 'IN_PROGRESS' | 'GRADING' };
      data: { status: 'IN_PROGRESS' | 'GRADING' };
    }): Promise<{ count: number }>;
  };
};

export function reusableOpenAnswerGrade(
  answer: {
    gradingKey: string | null;
    isCorrect: boolean | null;
    scorePercent: number | null;
    feedback: string | null;
    gradingMissed: unknown;
  },
  gradingKey: string,
) {
  if (
    answer.gradingKey !== gradingKey ||
    answer.isCorrect === null ||
    answer.scorePercent === null ||
    !answer.feedback
  )
    return null;
  return {
    isCorrect: answer.isCorrect,
    scorePercent: answer.scorePercent,
    feedback: answer.feedback,
    missed: Array.isArray(answer.gradingMissed)
      ? answer.gradingMissed.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

export async function claimAttemptForGrading(
  store: AttemptStatusStore,
  input: { attemptId: string; userId: string },
) {
  const claimed = await store.quizAttempt.updateMany({
    where: { id: input.attemptId, userId: input.userId, status: 'IN_PROGRESS' },
    data: { status: 'GRADING' },
  });
  if (!claimed.count)
    throw new AppError(409, 'ATTEMPT_SUBMISSION_IN_PROGRESS', 'This quiz is already being graded.');
}

export async function releaseAttemptGrading(store: AttemptStatusStore, attemptId: string) {
  await store.quizAttempt.updateMany({
    where: { id: attemptId, status: 'GRADING' },
    data: { status: 'IN_PROGRESS' },
  });
}
