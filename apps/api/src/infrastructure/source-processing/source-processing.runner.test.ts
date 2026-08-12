import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn();
  const sourceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transactionClient = {
    $queryRaw: queryRaw,
    source: { updateMany: sourceUpdateMany },
    job: { update: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (operation: unknown) => {
      if (typeof operation === 'function') return operation(transactionClient);
      return Promise.all(operation as Promise<unknown>[]);
    }),
    job: { update: vi.fn() },
    source: { updateMany: vi.fn() },
  };
  return { prisma, queryRaw, sourceUpdateMany };
});

vi.mock('../database/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../ai/provider.js', () => ({ aiProvider: {} }));
vi.mock('../storage/storage.js', () => ({ storageForProvider: vi.fn() }));

import { SourceProcessingRunner } from './source-processing.runner.js';

describe('in-process source processing runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValueOnce([{ entityId: 'source-stale' }]).mockResolvedValue([]);
  });

  it('recovers interrupted jobs idempotently and reports in-process health', async () => {
    const runner = new SourceProcessingRunner(60_000, 600_000);
    await runner.start();
    expect(runner.status()).toMatchObject({
      mode: 'in-process',
      state: 'running',
      pollIntervalMs: 60_000,
      staleLeaseMs: 600_000,
    });
    expect(mocks.sourceUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['source-stale'] }, processingStatus: 'PROCESSING' },
      data: {
        processingStatus: 'QUEUED',
        processingErrorCode: null,
        processingErrorMessage: null,
      },
    });
    const recoverySql = (mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(' ');
    expect(recoverySql).toContain(`status = 'QUEUED'`);
    expect(recoverySql).toContain('GREATEST("attemptCount" - 1, 0)');
    expect(recoverySql).toContain(`status = 'RUNNING'`);
    await runner.stop();
    expect(runner.status().state).toBe('stopped');
  });
});
