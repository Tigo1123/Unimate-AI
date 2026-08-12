import { PrismaClient } from '@prisma/client';
import {
  createAIProvider,
  loadAIEnvironment,
  loadRootEnvironment,
  safeAIStartupLines,
} from '@unimate/ai';
import {
  createStorage,
  createStorageForProvider,
  loadStorageEnvironment,
  safeStorageStartupLine,
} from '@unimate/storage';
import { SourceProcessorService } from './services/source-processor.service.js';

const prisma = new PrismaClient();
const rootEnvironment = loadRootEnvironment();
const aiEnvironment = loadAIEnvironment(rootEnvironment);
// Match AI configuration precedence: explicit root deployment settings win over
// workspace-local values that may be loaded as import side effects.
const runtimeEnvironment = { ...process.env, ...rootEnvironment };
const storageEnvironment = loadStorageEnvironment(runtimeEnvironment);
const workerId = `worker-${process.pid}`;
const interval = Number(runtimeEnvironment.WORKER_POLL_INTERVAL_MS ?? 2000);
const storage = createStorage(storageEnvironment);
const storageProviders = new Map<string, ReturnType<typeof createStorage>>([
  [storage.provider, storage],
]);
const storageForProvider = (provider: string) => {
  if (provider !== 'local' && provider !== 'r2')
    throw new Error(`Unsupported storage provider: ${provider}`);
  const existing = storageProviders.get(provider);
  if (existing) return existing;
  const created = createStorageForProvider(provider, storageEnvironment);
  storageProviders.set(provider, created);
  return created;
};
const ai = createAIProvider({
  provider: aiEnvironment.AI_PROVIDER,
  apiKey: aiEnvironment.AI_API_KEY,
  baseUrl: aiEnvironment.AI_BASE_URL,
  chatModel: aiEnvironment.AI_MODEL,
  embeddingModel: aiEnvironment.EMBEDDING_MODEL,
  embeddingDimensions: aiEnvironment.EMBEDDING_DIMENSIONS,
  temperature: aiEnvironment.AI_TEMPERATURE,
  maxOutputTokens: aiEnvironment.AI_MAX_OUTPUT_TOKENS,
  timeoutMs: aiEnvironment.AI_TIMEOUT_MS,
  maxRetries: aiEnvironment.AI_MAX_RETRIES,
  log: (level, message, metadata) =>
    level === 'error' ? console.error(message, metadata) : console.warn(message, metadata),
});
const processor = new SourceProcessorService(prisma, ai, storageForProvider);

async function claimJob() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Job" WHERE status = 'QUEUED' AND "availableAt" <= NOW() ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows[0]) return null;
    return tx.job.update({
      where: { id: rows[0].id },
      data: {
        status: 'RUNNING',
        lockedAt: new Date(),
        lockedBy: workerId,
        attemptCount: { increment: 1 },
      },
    });
  });
}

async function tick() {
  const job = await claimJob();
  if (!job) return;
  try {
    if (job.type === 'PROCESS_SOURCE') await processor.process(job.entityId);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', completedAt: new Date() },
    });
  } catch (error) {
    const safeMessage =
      error instanceof Error && /No readable|No useful|Unsupported/.test(error.message)
        ? error.message.slice(0, 300)
        : 'The source could not be processed. Please retry or use another file.';
    const retry = job.attemptCount < job.maxAttempts;
    await prisma.$transaction([
      prisma.job.update({
        where: { id: job.id },
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          availableAt: new Date(Date.now() + 5000 * job.attemptCount),
          lockedAt: null,
          lockedBy: null,
          errorCode: 'PROCESSING_FAILED',
        },
      }),
      prisma.source.updateMany({
        where: { id: job.entityId },
        data: {
          processingStatus: retry ? 'QUEUED' : 'FAILED',
          processingErrorCode: 'PROCESSING_FAILED',
          processingErrorMessage: safeMessage,
        },
      }),
    ]);
    console.error('Source processing failed', {
      jobId: job.id,
      sourceId: job.entityId,
      attempt: job.attemptCount,
      error,
    });
  }
}

console.warn(
  'DEPRECATED: standalone worker started. Source processing now runs inside the API; do not run both in production.',
);
console.log(`UniMate worker ${workerId} started with ${ai.name}/${ai.embeddingModel}`);
console.log(safeStorageStartupLine(storageEnvironment));
if ((process.env.NODE_ENV ?? 'development') === 'development') {
  for (const line of safeAIStartupLines(aiEnvironment)) console.log(line);
}
const timer = setInterval(() => void tick(), interval);
void tick();
async function shutdown() {
  clearInterval(timer);
  await prisma.$disconnect();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
