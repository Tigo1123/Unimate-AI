import { z } from 'zod';

export const summaryOutputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(20),
});
export const flashcardOutputSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().min(3),
        back: z.string().min(3),
        topic: z.string().min(1).max(160),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
        sourceChunkIndex: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(50),
});
export const quizOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'PROBLEM_SOLVING']),
        prompt: z.string().min(5),
        options: z.array(z.string()).max(6),
        correctAnswer: z.string().min(1),
        explanation: z.string().min(3),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
        topic: z.string().min(1).max(160),
        sourceChunkIndex: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(30),
});

export type QuizOutput = z.infer<typeof quizOutputSchema>;
