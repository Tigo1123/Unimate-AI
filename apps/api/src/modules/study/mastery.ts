export function calculateMastery(correctAnswers: number, totalAnswers: number) {
  if (
    !Number.isInteger(correctAnswers) ||
    !Number.isInteger(totalAnswers) ||
    correctAnswers < 0 ||
    totalAnswers < 0 ||
    correctAnswers > totalAnswers
  )
    throw new Error('Invalid mastery counts');
  return totalAnswers === 0 ? 0 : (correctAnswers / totalAnswers) * 100;
}
