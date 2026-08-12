import { Router } from 'express';
import { courseSchema, noteSchema, profileSchema, semesterSchema } from '@unimate/contracts';
import { z } from 'zod';
import { prisma } from '../../infrastructure/database/prisma.js';
import { validate } from '../../middleware/validate.js';
import { AppError, notFound } from '../../shared/errors/app-error.js';
import { ok } from '../../shared/http/respond.js';
import { storageForProvider } from '../../infrastructure/storage/storage.js';

const router = Router();
const patchSemester = semesterSchema.partial();
const patchCourse = courseSchema.partial();
const patchNote = noteSchema.partial();

router.get('/profile', async (req, res) =>
  ok(res, await prisma.userProfile.findUnique({ where: { userId: req.user!.id } })),
);
router.patch('/profile', validate(profileSchema), async (req, res) => {
  const profile = await prisma.userProfile.update({
    where: { userId: req.user!.id },
    data: req.body,
  });
  const complete = Boolean(
    profile.fullName && profile.universityName && profile.countryCode && profile.program,
  );
  if (complete)
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { onboardingCompletedAt: new Date() },
    });
  ok(res, profile);
});

router.get('/semesters', async (req, res) =>
  ok(
    res,
    await prisma.semester.findMany({
      where: { userId: req.user!.id },
      include: { _count: { select: { courses: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
router.post('/semesters', validate(semesterSchema), async (req, res) =>
  ok(res, await prisma.semester.create({ data: { ...req.body, userId: req.user!.id } }), 201),
);
router.patch('/semesters/:id', validate(patchSemester), async (req, res) => {
  const result = await prisma.semester.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: req.body,
  });
  if (!result.count) throw notFound('semester');
  ok(res, await prisma.semester.findUnique({ where: { id: req.params.id } }));
});
router.post('/semesters/:id/activate', async (req, res) => {
  const semester = await prisma.semester.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!semester) throw notFound('semester');
  await prisma.$transaction([
    prisma.semester.updateMany({
      where: { userId: req.user!.id, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    }),
    prisma.semester.update({ where: { id: semester.id }, data: { status: 'ACTIVE' } }),
  ]);
  ok(res, { activeSemesterId: semester.id });
});
router.delete('/semesters/:id', async (req, res) => {
  const semester = await prisma.semester.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: { _count: { select: { courses: true } } },
  });
  if (!semester) throw notFound('semester');
  if (semester._count.courses)
    throw new AppError(409, 'SEMESTER_NOT_EMPTY', 'Move or delete its courses first.');
  await prisma.semester.delete({ where: { id: semester.id } });
  ok(res, { deleted: true });
});

router.get('/courses', async (req, res) =>
  ok(
    res,
    await prisma.course.findMany({
      where: {
        userId: req.user!.id,
        ...(req.query.semesterId ? { semesterId: String(req.query.semesterId) } : {}),
      },
      include: { semester: true, _count: { select: { sources: true, quizzes: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
  ),
);
router.post('/courses', validate(courseSchema), async (req, res) => {
  const semester = await prisma.semester.findFirst({
    where: { id: req.body.semesterId, userId: req.user!.id },
  });
  if (!semester) throw notFound('semester');
  const course = await prisma.course.create({ data: { ...req.body, userId: req.user!.id } });
  await prisma.activity.create({
    data: {
      userId: req.user!.id,
      courseId: course.id,
      type: 'COURSE_CREATED',
      entityType: 'Course',
      entityId: course.id,
      metadata: { name: course.name },
    },
  });
  ok(res, course, 201);
});
router.get('/courses/:id', async (req, res) => {
  const course = await prisma.course.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    include: {
      semester: true,
      _count: { select: { sources: true, notes: true, quizzes: true, flashcards: true } },
    },
  });
  if (!course) throw notFound('course');
  ok(res, course);
});
router.patch('/courses/:id', validate(patchCourse), async (req, res) => {
  if (
    req.body.semesterId &&
    !(await prisma.semester.findFirst({ where: { id: req.body.semesterId, userId: req.user!.id } }))
  )
    throw notFound('semester');
  const result = await prisma.course.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: req.body,
  });
  if (!result.count) throw notFound('course');
  ok(res, await prisma.course.findUnique({ where: { id: req.params.id } }));
});
router.delete('/courses/:id', async (req, res) => {
  const result = await prisma.course.deleteMany({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!result.count) throw notFound('course');
  ok(res, { deleted: true });
});

router.get('/courses/:courseId/notes', async (req, res) =>
  ok(
    res,
    await prisma.note.findMany({
      where: { courseId: req.params.courseId, userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
    }),
  ),
);
router.post('/courses/:courseId/notes', validate(noteSchema), async (req, res) => {
  if (
    !(await prisma.course.findFirst({ where: { id: req.params.courseId, userId: req.user!.id } }))
  )
    throw notFound('course');
  ok(
    res,
    await prisma.note.create({
      data: { ...req.body, courseId: req.params.courseId, userId: req.user!.id },
    }),
    201,
  );
});
router.patch('/notes/:id', validate(patchNote), async (req, res) => {
  const result = await prisma.note.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: req.body,
  });
  if (!result.count) throw notFound('note');
  ok(res, await prisma.note.findUnique({ where: { id: req.params.id } }));
});
router.delete('/notes/:id', async (req, res) => {
  const result = await prisma.note.deleteMany({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!result.count) throw notFound('note');
  ok(res, { deleted: true });
});

router.get('/search', async (req, res) => {
  const q = z.string().trim().min(1).max(100).parse(req.query.q);
  const [courses, sources, notes] = await Promise.all([
    prisma.course.findMany({
      where: {
        userId: req.user!.id,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
    prisma.source.findMany({
      where: { userId: req.user!.id, displayName: { contains: q, mode: 'insensitive' } },
      take: 10,
    }),
    prisma.note.findMany({
      where: {
        userId: req.user!.id,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    }),
  ]);
  ok(res, { courses, sources, notes });
});

router.get('/dashboard', async (req, res) => {
  const [activeSemester, courses, activities, recentSources, recentQuizzes] = await Promise.all([
    prisma.semester.findFirst({ where: { userId: req.user!.id, status: 'ACTIVE' } }),
    prisma.course.findMany({
      where: { userId: req.user!.id, status: 'ACTIVE' },
      include: { _count: { select: { sources: true, quizzes: true } } },
      take: 8,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.activity.findMany({
      where: { userId: req.user!.id },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.source.findMany({
      where: { userId: req.user!.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.quiz.findMany({
      where: { userId: req.user!.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  ok(res, { activeSemester, courses, activities, recentSources, recentQuizzes });
});

router.delete('/account', async (req, res) => {
  const sources = await prisma.source.findMany({
    where: { userId: req.user!.id },
    select: { storageKey: true, storageProvider: true },
  });
  for (const source of sources)
    await storageForProvider(source.storageProvider).delete(source.storageKey);
  await prisma.user.delete({ where: { id: req.user!.id } });
  res.clearCookie('unimate_refresh', { path: '/api/v1/auth' });
  ok(res, { deleted: true });
});

export { router as coreRouter };
