import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '@unimate/ai';
import { GenerationService, quizQuestionBatchSizes } from './generation.service.js';

vi.mock('../../infrastructure/observability/ai-telemetry.js', () => ({
  writeAiTelemetry: vi.fn(),
}));

function fixture(chunkCount: number, tokensPerChunk: number) {
  let chunks = Array.from({ length: chunkCount }, (_, index) => ({
    id: crypto.randomUUID(),
    userId: 'user-1',
    courseId: 'course-1',
    sourceId: 'source-1',
    chunkIndex: index,
    content: `Chunk ${index} ${'x'.repeat(tokensPerChunk * 4)}`,
    tokenCount: tokensPerChunk,
    pageStart: index + 1,
    pageEnd: index + 1,
    metadata: { sectionTitle: `Section ${index}` },
    source: { displayName: 'lecture.pdf' },
  }));
  const summaries = new Map<string, Record<string, unknown>>();
  const prisma = {
    course: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'course-1',
        name: 'Course',
        user: { profile: { aiResponseLanguage: 'English' } },
      }),
    },
    source: { count: vi.fn().mockResolvedValue(1) },
    documentChunk: { findMany: vi.fn().mockImplementation(async () => chunks) },
    summary: {
      findUnique: vi
        .fn()
        .mockImplementation(async ({ where }: { where: { generationKey: string } }) =>
          summaries.get(where.generationKey),
        ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const value = { id: crypto.randomUUID(), ...data, sources: [] };
        summaries.set(data.generationKey as string, value);
        return value;
      }),
    },
  };
  const generateStructured = vi.fn().mockResolvedValue({
    data: { title: 'Generated', content: 'Generated content' },
    model: 'gemini-3.5-flash',
    providerRequests: 1,
  });
  const ai = {
    name: 'gemini',
    chatModel: 'gemini-3.5-flash',
    embeddingModel: 'local-hash-v1',
    generateStructured,
  } as unknown as AIProvider;
  return {
    service: new GenerationService(prisma as never, ai),
    generateStructured,
    changeFirstChunk() {
      chunks = [{ ...chunks[0]!, content: `${chunks[0]!.content} updated` }, ...chunks.slice(1)];
    },
  };
}

const summaryInput = {
  userId: 'user-1',
  courseId: 'course-1',
  sourceIds: [] as string[],
  type: 'KEY_POINTS' as const,
};

describe('GenerationService request optimization', () => {
  it('splits complex quizzes into batches of at most six questions', () => {
    expect(quizQuestionBatchSizes(18)).toEqual([6, 6, 6]);
    expect(quizQuestionBatchSizes(14)).toEqual([6, 6, 2]);
  });
  it('generates a real 426-chunk/58k-token document in one provider request and caches it', async () => {
    const { service, generateStructured } = fixture(426, 135);
    const first = await service.summary(summaryInput);
    const second = await service.summary(summaryInput);
    expect(first.id).toBe(second.id);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache when source content changes', async () => {
    const fixtureState = fixture(20, 200);
    await fixtureState.service.summary(summaryInput);
    fixtureState.changeFirstChunk();
    await fixtureState.service.summary(summaryInput);
    expect(fixtureState.generateStructured).toHaveBeenCalledTimes(2);
  });

  it('uses minimum token-aware batches and synthesizes only for multiple batches', async () => {
    const { service, generateStructured } = fixture(600, 500);
    await service.summary(summaryInput);
    // Two content batches under 200k estimated tokens, followed by one synthesis request.
    expect(generateStructured).toHaveBeenCalledTimes(3);
  });

  it('deduplicates simultaneous identical generation actions', async () => {
    const fixtureState = fixture(20, 200);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixtureState.generateStructured.mockImplementationOnce(async () => {
      await wait;
      return {
        data: { title: 'Generated', content: 'Generated content' },
        model: 'gemini-3.5-flash',
        providerRequests: 1,
      };
    });
    const first = fixtureState.service.summary(summaryInput);
    const second = fixtureState.service.summary(summaryInput);
    await vi.waitFor(() => expect(fixtureState.generateStructured).toHaveBeenCalledTimes(1));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    expect(fixtureState.generateStructured).toHaveBeenCalledTimes(1);
  });
});
