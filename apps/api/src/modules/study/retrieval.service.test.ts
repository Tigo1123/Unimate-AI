import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { AIProvider } from '@unimate/ai';
import { RetrievalService } from './retrieval.service.js';

describe('RetrievalService ownership scope', () => {
  it('binds user, course, and selected source IDs into the vector query', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: query } as unknown as PrismaClient;
    const ai = {
      embeddingModel: 'test-model',
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    } as unknown as AIProvider;
    const service = new RetrievalService(prisma, ai);
    await service.retrieve({
      userId: '11111111-1111-4111-8111-111111111111',
      courseId: '22222222-2222-4222-8222-222222222222',
      sourceIds: ['33333333-3333-4333-8333-333333333333'],
      query: 'normalization',
      limit: 8,
    });
    const sql = query.mock.calls[0]?.[0] as { values: unknown[]; strings: string[] };
    expect(sql.values).toEqual(
      expect.arrayContaining([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'test-model',
      ]),
    );
    expect(sql.strings.join('')).toContain('::uuid');
  });
});
