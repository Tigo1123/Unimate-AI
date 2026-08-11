import { describe, expect, it } from 'vitest';
import { createAIProvider } from '@unimate/ai';
import { GenerationService } from './generation.service.js';
import { GradingService } from './grading.service.js';

const demo = createAIProvider({
  provider: 'mock',
  chatModel: 'demo-chat',
  embeddingModel: 'local-hash-v1',
  embeddingDimensions: 1536,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maxRetries: 0,
});

describe('Demo mode safety', () => {
  it('does not manufacture flashcards or quizzes', async () => {
    const service = new GenerationService({} as never, demo);
    await expect(
      service.flashcards({
        userId: crypto.randomUUID(),
        courseId: crypto.randomUUID(),
        sourceIds: [],
        count: 10,
        title: 'Demo cards',
      }),
    ).rejects.toMatchObject({ code: 'AI_DEMO_UNAVAILABLE', status: 503 });
    await expect(
      service.quiz({
        userId: crypto.randomUUID(),
        courseId: crypto.randomUUID(),
        sourceIds: [],
        count: 10,
        title: 'Demo quiz',
        difficulty: 'MIXED',
        questionType: 'MULTIPLE_CHOICE',
      }),
    ).rejects.toMatchObject({ code: 'AI_DEMO_UNAVAILABLE', status: 503 });
  });

  it('does not present keyword overlap as AI grading', async () => {
    const service = new GradingService(demo);
    await expect(
      service.grade({
        question: 'What is AI?',
        expectedAnswer: 'Artificial intelligence',
        studentAnswer: 'Artificial intelligence',
        source: 'AI is an entrepreneurial tool.',
        language: 'English',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
});
