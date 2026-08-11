import { Router } from 'express';
import { chatMessageSchema } from '@unimate/contracts';
import { z } from 'zod';
import { aiProvider } from '../../infrastructure/ai/provider.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../shared/errors/app-error.js';
import { ok } from '../../shared/http/respond.js';
import { calculateMastery } from './mastery.js';
import { RetrievalService } from './retrieval.service.js';
import { RagChatService } from './rag-chat.service.js';
import { GenerationService } from './generation.service.js';
import { GradingService, stableGradingKey } from './grading.service.js';
import {
  claimAttemptForGrading,
  releaseAttemptGrading,
  reusableOpenAnswerGrade,
} from './quiz-submission.js';

const router = Router();
const retrievalService = new RetrievalService(prisma, aiProvider);
const ragChatService = new RagChatService(prisma, aiProvider, retrievalService, env.RAG_TOP_K);
const generationService = new GenerationService(prisma, aiProvider);
const gradingService = new GradingService(aiProvider);
router.get('/ai/status', (_req, res) =>
  ok(res, {
    mode: aiProvider.name !== 'mock' ? 'AI_TUTOR' : 'DEMO',
    provider: aiProvider.name,
    label: aiProvider.name !== 'mock' ? 'AI Tutor' : 'Demo mode',
    message:
      aiProvider.name !== 'mock'
        ? 'AI Tutor mode: responses are generated from your indexed course material.'
        : 'Demo mode: remote AI is not configured. Clearly labeled source outlines are available, but AI generation and grading are disabled.',
  }),
);
const createConversation = z.object({
  title: z.string().trim().min(1).max(200).default('New conversation'),
  mode: z.enum(['EXPLAIN', 'SIMPLIFY', 'SUMMARIZE', 'STUDY', 'EXAM_PREP']).default('EXPLAIN'),
});
const summaryInput = z.object({
  sourceIds: z.array(z.string().uuid()).default([]),
  title: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['SHORT', 'DETAILED', 'EXAM_REVISION', 'KEY_POINTS']).default('KEY_POINTS'),
});
const flashInput = z.object({
  sourceIds: z.array(z.string().uuid()).default([]),
  title: z.string().trim().min(1).max(200).default('Study cards'),
  count: z.number().int().min(1).max(50).default(10),
});
const quizInput = z.object({
  sourceIds: z.array(z.string().uuid()).default([]),
  title: z.string().trim().min(1).max(200).default('Practice quiz'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD', 'MIXED']).default('MIXED'),
  questionCount: z.number().int().min(1).max(30).default(10),
  questionType: z
    .enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'PROBLEM_SOLVING'])
    .default('MULTIPLE_CHOICE'),
});
const explanationInput = z.object({
  sourceIds: z.array(z.string().uuid()).default([]),
  mode: z.enum(['SIMPLE', 'STANDARD', 'DETAILED', 'EXAM_PREPARATION']).default('STANDARD'),
});

async function ownedCourse(userId: string, courseId: string) {
  const course = await prisma.course.findFirst({ where: { id: courseId, userId } });
  if (!course) throw notFound('course');
  return course;
}

router.post('/courses/:courseId/conversations', validate(createConversation), async (req, res) => {
  await ownedCourse(req.user!.id, req.params.courseId);
  ok(
    res,
    await prisma.conversation.create({
      data: { ...req.body, userId: req.user!.id, courseId: req.params.courseId },
    }),
    201,
  );
});
router.get('/courses/:courseId/conversations', async (req, res) =>
  ok(
    res,
    await prisma.conversation.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      orderBy: { updatedAt: 'desc' },
    }),
  ),
);
router.get('/conversations/:id/messages', async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!conversation) throw notFound('conversation');
  ok(
    res,
    await prisma.message.findMany({
      where: { conversationId: conversation.id },
      include: {
        citations: {
          include: {
            source: { select: { displayName: true } },
            documentChunk: { select: { metadata: true } },
          },
          orderBy: { citationOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
});
router.post('/conversations/:id/messages', validate(chatMessageSchema), async (req, res) => {
  ok(
    res,
    await ragChatService.answer({
      userId: req.user!.id,
      conversationId: req.params.id,
      content: req.body.content,
      mode: req.body.mode,
      ...(req.body.action ? { action: req.body.action } : {}),
      ...(req.body.sourceIds ? { sourceIds: req.body.sourceIds } : {}),
    }),
  );
});

router.post('/courses/:courseId/summaries', validate(summaryInput), async (req, res) => {
  ok(
    res,
    await generationService.summary({
      userId: req.user!.id,
      courseId: req.params.courseId,
      sourceIds: req.body.sourceIds,
      type: req.body.type,
      ...(req.body.title ? { title: req.body.title } : {}),
    }),
    201,
  );
});
router.post('/courses/:courseId/explanations', validate(explanationInput), async (req, res) =>
  ok(
    res,
    await generationService.explanation({
      userId: req.user!.id,
      courseId: req.params.courseId,
      sourceIds: req.body.sourceIds,
      mode: req.body.mode,
    }),
    201,
  ),
);
router.get('/courses/:courseId/summaries', async (req, res) =>
  ok(
    res,
    await prisma.summary.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      include: {
        sources: {
          orderBy: { sourceId: 'asc' },
          include: { source: { select: { id: true, displayName: true, pageCount: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
router.delete('/summaries/:id', async (req, res) => {
  const result = await prisma.summary.deleteMany({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!result.count) throw notFound('summary');
  ok(res, { deleted: true });
});

router.post('/courses/:courseId/flashcard-sets', validate(flashInput), async (req, res) => {
  ok(
    res,
    await generationService.flashcards({
      userId: req.user!.id,
      courseId: req.params.courseId,
      sourceIds: req.body.sourceIds,
      count: req.body.count,
      title: req.body.title,
    }),
    201,
  );
});
router.get('/courses/:courseId/flashcard-sets', async (req, res) =>
  ok(
    res,
    await prisma.flashcardSet.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      include: {
        cards: {
          include: {
            reviews: { where: { userId: req.user!.id }, orderBy: { reviewedAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
router.post('/flashcards/:id/reviews', async (req, res) => {
  const rating = z.enum(['KNOWN', 'DIFFICULT']).parse(req.body.rating);
  const card = await prisma.flashcard.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!card) throw notFound('flashcard');
  ok(
    res,
    await prisma.flashcardReview.create({
      data: { userId: req.user!.id, flashcardId: card.id, rating },
    }),
    201,
  );
});

router.post('/courses/:courseId/quizzes', validate(quizInput), async (req, res) => {
  ok(
    res,
    await generationService.quiz({
      userId: req.user!.id,
      courseId: req.params.courseId,
      sourceIds: req.body.sourceIds,
      count: req.body.questionCount,
      title: req.body.title,
      difficulty: req.body.difficulty,
      questionType: req.body.questionType,
    }),
    201,
  );
});
router.get('/courses/:courseId/quizzes', async (req, res) =>
  ok(
    res,
    await prisma.quiz.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      include: { _count: { select: { questions: true, attempts: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
router.get('/quizzes/:id', async (req, res) => {
  const quiz = await prisma.quiz.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      questions: {
        select: { id: true, position: true, type: true, prompt: true, options: true, topic: true },
      },
    },
  });
  if (!quiz) throw notFound('quiz');
  ok(res, quiz);
});
router.post('/quizzes/:id/attempts', async (req, res) => {
  const quiz = await prisma.quiz.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!quiz) throw notFound('quiz');
  ok(
    res,
    await prisma.quizAttempt.create({ data: { userId: req.user!.id, quizId: quiz.id } }),
    201,
  );
});
router.put('/quiz-attempts/:attemptId/answers/:questionId', async (req, res) => {
  const selectedAnswer = z.string().max(1000).parse(req.body.selectedAnswer);
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: req.params.attemptId, userId: req.user!.id, status: 'IN_PROGRESS' },
    include: { quiz: { include: { questions: true } } },
  });
  if (!attempt || !attempt.quiz.questions.some((q) => q.id === req.params.questionId))
    throw notFound('attempt');
  const existing = await prisma.quizAnswer.findUnique({
    where: {
      attemptId_questionId: {
        attemptId: attempt.id,
        questionId: req.params.questionId,
      },
    },
  });
  const answerChanged = existing?.selectedAnswer !== selectedAnswer;
  ok(
    res,
    await prisma.quizAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: req.params.questionId } },
      create: { attemptId: attempt.id, questionId: req.params.questionId, selectedAnswer },
      update: {
        selectedAnswer,
        answeredAt: new Date(),
        ...(answerChanged
          ? {
              isCorrect: null,
              scorePercent: null,
              feedback: null,
              gradingKey: null,
            }
          : {}),
      },
    }),
  );
});
router.post('/quiz-attempts/:id/submit', async (req, res) => {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: req.params.id, userId: req.user!.id, status: 'IN_PROGRESS' },
    include: {
      answers: true,
      quiz: {
        include: { questions: { include: { documentChunk: { select: { content: true } } } } },
      },
    },
  });
  if (!attempt) throw notFound('attempt');
  await claimAttemptForGrading(prisma, { attemptId: attempt.id, userId: req.user!.id });
  try {
    const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const profile = await prisma.userProfile.findUnique({
      where: { userId: req.user!.id },
      select: { aiResponseLanguage: true },
    });
    const language = profile?.aiResponseLanguage || 'English';
    const grades = new Map<
      string,
      {
        isCorrect: boolean;
        scorePercent: number;
        feedback: string;
        missed?: string[];
      }
    >();
    const gradingKeys = new Map<string, string>();
    const gradingItems = [];
    let openAnswerCount = 0;
    let cacheHits = 0;
    for (const question of attempt.quiz.questions) {
      const answer = answers.get(question.id);
      if (!answer) continue;
      if (question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') {
        const isCorrect = answer.selectedAnswer.trim() === question.correctAnswer.trim();
        grades.set(question.id, {
          isCorrect,
          scorePercent: isCorrect ? 100 : 0,
          feedback: isCorrect ? 'Correct.' : question.explanation,
        });
        continue;
      }
      openAnswerCount++;
      const item = {
        questionId: question.id,
        question: question.prompt,
        expectedAnswer: question.correctAnswer,
        studentAnswer: answer.selectedAnswer,
        source: question.documentChunk?.content ?? question.explanation,
      };
      const gradingKey = stableGradingKey({
        attemptId: attempt.id,
        item,
        model: aiProvider.chatModel,
        language,
      });
      gradingKeys.set(question.id, gradingKey);
      const cachedGrade = reusableOpenAnswerGrade(answer, gradingKey);
      if (cachedGrade) {
        cacheHits++;
        grades.set(question.id, cachedGrade);
      } else gradingItems.push({ ...item, gradingKey });
    }
    const generatedGrades = await gradingService.gradeBatch({
      items: gradingItems,
      language,
      openAnswerCount,
      cacheHits,
    });
    for (const grade of generatedGrades) grades.set(grade.questionId, grade);

    // Persist reusable open-answer grades before progress aggregation. If a later database
    // operation fails, retrying the unchanged submission consumes no additional Gemini quota.
    await prisma.$transaction(
      generatedGrades.map((grade) => {
        const answer = answers.get(grade.questionId)!;
        const gradingKey = gradingKeys.get(grade.questionId)!;
        return prisma.quizAnswer.update({
          where: { id: answer.id },
          data: {
            isCorrect: grade.isCorrect,
            scorePercent: grade.scorePercent,
            feedback: grade.feedback,
            gradingKey,
            gradingMissed: grade.missed,
          },
        });
      }),
    );

    let correct = 0;
    let totalScore = 0;
    await prisma.$transaction(async (tx) => {
      for (const question of attempt.quiz.questions) {
        const answer = answers.get(question.id);
        const gradingKey = gradingKeys.get(question.id);
        const grade = grades.get(question.id) ?? {
          isCorrect: false,
          scorePercent: 0,
          feedback: 'No answer was submitted.',
        };
        const isCorrect = grade.isCorrect;
        if (isCorrect) correct++;
        totalScore += grade.scorePercent;
        if (answer)
          await tx.quizAnswer.update({
            where: { id: answer.id },
            data: {
              isCorrect,
              scorePercent: grade.scorePercent,
              feedback: grade.feedback,
              ...(gradingKey
                ? {
                    gradingKey,
                    gradingMissed: grade.missed ?? [],
                  }
                : {}),
            },
          });
        const existing = await tx.topicMastery.findUnique({
          where: {
            userId_courseId_topic: {
              userId: req.user!.id,
              courseId: attempt.quiz.courseId,
              topic: question.topic,
            },
          },
        });
        const weight =
          question.difficulty === 'HARD' ? 3 : question.difficulty === 'MEDIUM' ? 2 : 1;
        const c = (existing?.correctAnswers ?? 0) + (isCorrect ? weight : 0);
        const total = (existing?.totalAnswers ?? 0) + weight;
        await tx.topicMastery.upsert({
          where: {
            userId_courseId_topic: {
              userId: req.user!.id,
              courseId: attempt.quiz.courseId,
              topic: question.topic,
            },
          },
          create: {
            userId: req.user!.id,
            courseId: attempt.quiz.courseId,
            topic: question.topic,
            correctAnswers: c,
            totalAnswers: total,
            masteryPercent: calculateMastery(c, total),
          },
          update: {
            correctAnswers: c,
            totalAnswers: total,
            masteryPercent: calculateMastery(c, total),
          },
        });
      }
      await tx.quizAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUBMITTED',
          correctCount: correct,
          incorrectCount: attempt.quiz.questions.length - correct,
          scorePercent: attempt.quiz.questions.length
            ? totalScore / attempt.quiz.questions.length
            : 0,
          submittedAt: new Date(),
        },
      });
    });
    ok(res, {
      attemptId: attempt.id,
      scorePercent: attempt.quiz.questions.length ? totalScore / attempt.quiz.questions.length : 0,
    });
  } catch (error) {
    await releaseAttemptGrading(prisma, attempt.id);
    throw error;
  }
});
router.get('/quiz-attempts/:id/results', async (req, res) => {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: req.params.id, userId: req.user!.id, status: 'SUBMITTED' },
    include: { answers: { include: { question: true } }, quiz: true },
  });
  if (!attempt) throw notFound('result');
  ok(res, attempt);
});

router.get('/courses/:courseId/progress', async (req, res) => {
  await ownedCourse(req.user!.id, req.params.courseId);
  const [documents, attempts, reviewed, topics, activities] = await Promise.all([
    prisma.source.count({
      where: { userId: req.user!.id, courseId: req.params.courseId, processingStatus: 'READY' },
    }),
    prisma.quizAttempt.findMany({
      where: { userId: req.user!.id, status: 'SUBMITTED', quiz: { courseId: req.params.courseId } },
      select: { scorePercent: true },
    }),
    prisma.flashcardReview.count({
      where: { userId: req.user!.id, flashcard: { courseId: req.params.courseId } },
    }),
    prisma.topicMastery.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      orderBy: { masteryPercent: 'asc' },
    }),
    prisma.activity.findMany({
      where: { userId: req.user!.id, courseId: req.params.courseId },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  ok(res, {
    documents,
    quizzesCompleted: attempts.length,
    averageQuizScore: attempts.length
      ? attempts.reduce((s, a) => s + (a.scorePercent ?? 0), 0) / attempts.length
      : 0,
    flashcardsReviewed: reviewed,
    weakTopics: topics,
    activities,
    disclaimer: 'Progress reflects activity completed in UniMate, not total academic knowledge.',
  });
});

export { router as studyRouter };
