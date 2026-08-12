import { randomUUID } from 'node:crypto';
import { aiProvider } from '../ai/provider.js';
import { prisma } from '../database/prisma.js';
import { storageForProvider } from '../storage/storage.js';
import { SourceProcessorService } from './source-processor.service.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STALE_LEASE_MS = 10 * 60_000;

export class SourceProcessingRunner {
  private readonly runnerId = `api-source-processor-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly processor = new SourceProcessorService(prisma, aiProvider, storageForProvider);
  private timer: NodeJS.Timeout | undefined;
  private currentTick: Promise<void> | undefined;
  private started = false;
  private stopping = false;
  private lastCompletedAt?: Date;
  private lastErrorAt?: Date;

  constructor(
    readonly pollIntervalMs = Number(
      process.env.WORKER_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS,
    ),
    readonly staleLeaseMs = Number(
      process.env.SOURCE_PROCESSING_STALE_LEASE_MS ?? DEFAULT_STALE_LEASE_MS,
    ),
  ) {}

  status() {
    return {
      mode: 'in-process' as const,
      state: this.stopping ? 'stopping' : this.started ? 'running' : 'stopped',
      active: Boolean(this.currentTick),
      pollIntervalMs: this.pollIntervalMs,
      staleLeaseMs: this.staleLeaseMs,
      lastCompletedAt: this.lastCompletedAt?.toISOString(),
      lastErrorAt: this.lastErrorAt?.toISOString(),
    };
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    await this.recoverStaleJobs();
    this.timer = setInterval(() => this.wake(), this.pollIntervalMs);
    this.timer.unref();
    this.wake();
  }

  wake() {
    if (!this.started || this.stopping || this.currentTick) return;
    this.currentTick = this.tick().finally(() => {
      this.currentTick = undefined;
    });
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.currentTick;
    this.started = false;
    this.stopping = false;
  }

  private async recoverStaleJobs() {
    const staleBefore = new Date(Date.now() - this.staleLeaseMs);
    const recovered = await prisma.$transaction(async (transaction) => {
      const jobs = await transaction.$queryRaw<{ entityId: string }[]>`
        UPDATE "Job"
        SET status = 'QUEUED',
            "availableAt" = NOW(),
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "attemptCount" = GREATEST("attemptCount" - 1, 0),
            "updatedAt" = NOW()
        WHERE type = 'PROCESS_SOURCE'
          AND status = 'RUNNING'
          AND "lockedAt" < ${staleBefore}
        RETURNING "entityId"
      `;
      if (jobs.length)
        await transaction.source.updateMany({
          where: {
            id: { in: jobs.map((job) => job.entityId) },
            processingStatus: 'PROCESSING',
          },
          data: {
            processingStatus: 'QUEUED',
            processingErrorCode: null,
            processingErrorMessage: null,
          },
        });
      return jobs.length;
    });
    if (recovered)
      console.warn('Recovered stale in-process source jobs', { recovered, staleBefore });
  }

  private async claimJob() {
    return prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Job"
        WHERE type = 'PROCESS_SOURCE'
          AND status = 'QUEUED'
          AND "availableAt" <= NOW()
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (!rows[0]) return null;
      return transaction.job.update({
        where: { id: rows[0].id },
        data: {
          status: 'RUNNING',
          lockedAt: new Date(),
          lockedBy: this.runnerId,
          attemptCount: { increment: 1 },
        },
      });
    });
  }

  private async tick() {
    try {
      await this.recoverStaleJobs();
      const job = await this.claimJob();
      if (!job) return;
      try {
        await this.processor.process(job.entityId);
        await prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'SUCCEEDED',
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            errorCode: null,
          },
        });
        this.lastCompletedAt = new Date();
      } catch (error) {
        this.lastErrorAt = new Date();
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
              availableAt: new Date(Date.now() + 5_000 * job.attemptCount),
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
        console.error('In-process source processing failed', {
          jobId: job.id,
          sourceId: job.entityId,
          attempt: job.attemptCount,
          retry,
          error,
        });
      }
    } catch (error) {
      this.lastErrorAt = new Date();
      console.error('In-process source processing poll failed', { error });
    }
  }
}

export const sourceProcessing = new SourceProcessingRunner();

export function sourceProcessingStartupLine() {
  return `Source processing: in-process queue (poll=${sourceProcessing.pollIntervalMs}ms, stale lease=${sourceProcessing.staleLeaseMs}ms)`;
}
