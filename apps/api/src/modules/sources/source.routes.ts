import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { storage } from '../../infrastructure/storage/storage.js';
import { AppError, notFound } from '../../shared/errors/app-error.js';
import { ok } from '../../shared/http/respond.js';

const router = Router();
const formats = new Map([
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024, files: 1 },
});

function validSignature(buffer: Buffer, extension: string) {
  if (extension === '.pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.docx' || extension === '.pptx')
    return buffer.subarray(0, 2).toString() === 'PK';
  if (['.txt', '.md', '.markdown'].includes(extension))
    return !buffer.subarray(0, 1024).includes(0);
  return false;
}

router.post('/courses/:courseId/sources', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Select a file to upload.');
  const extension = path.extname(file.originalname).toLowerCase();
  const mimeType = formats.get(extension);
  if (!mimeType || !validSignature(file.buffer, extension))
    throw new AppError(
      415,
      'UNSUPPORTED_FILE',
      'Only valid PDF, DOCX, PPTX, TXT, and Markdown files are supported.',
    );
  if (
    !(await prisma.course.findFirst({ where: { id: req.params.courseId, userId: req.user!.id } }))
  )
    throw notFound('course');
  const sourceCount = await prisma.source.count({
    where: { courseId: req.params.courseId, userId: req.user!.id },
  });
  if (sourceCount >= env.MAX_SOURCES_PER_COURSE)
    throw new AppError(
      409,
      'SOURCE_LIMIT_REACHED',
      `A course can contain up to ${env.MAX_SOURCES_PER_COURSE} sources.`,
    );
  const safeBase = path
    .basename(file.originalname)
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .slice(0, 180);
  const key = `${req.user!.id}/${req.params.courseId}/${randomUUID()}${extension}`;
  await storage.put(key, file.buffer);
  try {
    const source = await prisma.source.create({
      data: {
        userId: req.user!.id,
        courseId: req.params.courseId,
        displayName: safeBase,
        originalFileName: safeBase,
        mimeType,
        extension,
        sizeBytes: file.size,
        storageProvider: env.STORAGE_PROVIDER,
        storageKey: key,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        processingStatus: 'QUEUED',
      },
    });
    await prisma.$transaction([
      prisma.job.create({
        data: {
          userId: req.user!.id,
          type: 'PROCESS_SOURCE',
          entityType: 'Source',
          entityId: source.id,
          payload: { sourceId: source.id },
        },
      }),
      prisma.activity.create({
        data: {
          userId: req.user!.id,
          courseId: req.params.courseId,
          type: 'SOURCE_UPLOADED',
          entityType: 'Source',
          entityId: source.id,
          metadata: { name: safeBase },
        },
      }),
    ]);
    ok(res, source, 201);
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
});

router.get('/courses/:courseId/sources', async (req, res) =>
  ok(
    res,
    await prisma.source.findMany({
      where: { courseId: req.params.courseId, userId: req.user!.id },
      select: {
        id: true,
        displayName: true,
        originalFileName: true,
        mimeType: true,
        sizeBytes: true,
        processingStatus: true,
        processingErrorMessage: true,
        pageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ),
);
router.get('/sources/:id', async (req, res) => {
  const source = await prisma.source.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
    select: {
      id: true,
      courseId: true,
      displayName: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      processingStatus: true,
      processingErrorMessage: true,
      pageCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!source) throw notFound('source');
  ok(res, source);
});
router.get('/sources/:id/download', async (req, res) => {
  const source = await prisma.source.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!source) throw notFound('source');
  res.setHeader('Content-Type', source.mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(source.displayName)}`,
  );
  storage.open(source.storageKey).pipe(res);
});
router.patch('/sources/:id', async (req, res) => {
  const displayName = String(req.body.displayName ?? '')
    .trim()
    .slice(0, 200);
  if (!displayName) throw new AppError(400, 'INVALID_NAME', 'A source name is required.');
  const result = await prisma.source.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { displayName },
  });
  if (!result.count) throw notFound('source');
  ok(res, await prisma.source.findUnique({ where: { id: req.params.id } }));
});
router.post('/sources/:id/reprocess', async (req, res) => {
  const source = await prisma.source.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!source) throw notFound('source');
  await prisma.$transaction([
    prisma.source.update({
      where: { id: source.id },
      data: { processingStatus: 'QUEUED', processingErrorCode: null, processingErrorMessage: null },
    }),
    prisma.job.create({
      data: {
        userId: req.user!.id,
        type: 'PROCESS_SOURCE',
        entityType: 'Source',
        entityId: source.id,
        payload: { sourceId: source.id },
      },
    }),
  ]);
  ok(res, { queued: true });
});
router.delete('/sources/:id', async (req, res) => {
  const source = await prisma.source.findFirst({
    where: { id: req.params.id, userId: req.user!.id },
  });
  if (!source) throw notFound('source');
  await prisma.source.update({ where: { id: source.id }, data: { processingStatus: 'DELETING' } });
  await storage.delete(source.storageKey);
  await prisma.source.delete({ where: { id: source.id } });
  ok(res, { deleted: true });
});

export { router as sourceRouter };
