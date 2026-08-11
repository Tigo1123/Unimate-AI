import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { api } from '../lib/api';

type Question = {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  topic: string;
  type: string;
};
type Quiz = { id: string; title: string; questions: Question[] };
type Result = {
  scorePercent: number;
  correctCount: number;
  incorrectCount: number;
  answers: {
    id: string;
    selectedAnswer: string;
    isCorrect: boolean;
    scorePercent?: number;
    feedback?: string;
    question: Question & { correctAnswer: string; explanation: string };
  }[];
};

export function QuizAttempt() {
  const { attemptId = '' } = useParams();
  const [params] = useSearchParams();
  const quizId = params.get('quiz') ?? '';
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<unknown>();
  const query = useQuery({
    queryKey: ['quiz', quizId],
    queryFn: () => api.get<Quiz>(`/quizzes/${quizId}`),
    enabled: Boolean(quizId),
  });
  if (query.isLoading) return <Loading />;
  async function submit() {
    if (!query.data) return;
    try {
      for (const question of query.data.questions)
        if (answers[question.id])
          await api.put(`/quiz-attempts/${attemptId}/answers/${question.id}`, {
            selectedAnswer: answers[question.id],
          });
      await api.post(`/quiz-attempts/${attemptId}/submit`);
      setResult(await api.get<Result>(`/quiz-attempts/${attemptId}/results`));
    } catch (reason) {
      setError(reason);
    }
  }
  if (result)
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="card text-center">
          <p className="text-sm text-slate-500">Quiz complete</p>
          <h1 className="text-4xl font-bold">{Math.round(result.scorePercent)}%</h1>
          <p>
            {result.correctCount} correct · {result.incorrectCount} incorrect
          </p>
        </div>
        {result.answers.map((answer) => (
          <article className="card" key={answer.id}>
            <p className="font-semibold">{answer.question.prompt}</p>
            <p
              className={
                (answer.scorePercent ?? (answer.isCorrect ? 100 : 0)) >= 50
                  ? 'mt-2 text-green-700'
                  : 'mt-2 text-red-700'
              }
            >
              Your answer: {answer.selectedAnswer}{' '}
              {answer.scorePercent !== undefined ? `· ${Math.round(answer.scorePercent)}%` : ''}
            </p>
            {!answer.isCorrect && (
              <p className="text-sm">Correct answer: {answer.question.correctAnswer}</p>
            )}
            <p className="mt-3 text-sm text-slate-500">{answer.question.explanation}</p>
            {answer.feedback && (
              <p className="mt-2 text-sm font-medium">Feedback: {answer.feedback}</p>
            )}
          </article>
        ))}
        <Link className="btn-primary" to="/app">
          Return to dashboard
        </Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold">{query.data?.title}</h1>
        <p className="text-slate-500">Answer each question, then submit for grading.</p>
      </header>
      <ErrorBox error={error} />
      {query.data?.questions.map((question) => (
        <fieldset className="card" key={question.id}>
          <legend className="font-semibold">
            {question.position}. {question.prompt}
          </legend>
          {question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE' ? (
            <div className="mt-4 space-y-2">
              {question.options.map((option) => (
                <label
                  className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
                  key={option}
                >
                  <input
                    type="radio"
                    name={question.id}
                    checked={answers[question.id] === option}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [question.id]: option }))
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea
              className="field mt-4 min-h-32"
              value={answers[question.id] ?? ''}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
              }
              placeholder="Write your answer…"
            />
          )}
        </fieldset>
      ))}
      <button
        className="btn-primary"
        onClick={() => void submit()}
        disabled={!query.data?.questions.every((question) => answers[question.id])}
      >
        Submit quiz
      </button>
    </div>
  );
}
