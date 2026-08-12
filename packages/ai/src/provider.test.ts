import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIProviderError, createAIProvider } from './index.js';

const provider = createAIProvider({
  provider: 'mock',
  chatModel: 'mock-chat',
  embeddingModel: 'local-hash-v1',
  embeddingDimensions: 1536,
  maxOutputTokens: 1000,
  timeoutMs: 1000,
  maxRetries: 0,
});
describe('mock AI provider', () => {
  it('returns stable correctly-sized embeddings', async () => {
    const first = await provider.embed('normalization database');
    const second = await provider.embed('normalization database');
    expect(first).toHaveLength(1536);
    expect(first).toEqual(second);
  });
  it('validates structured mock output', async () => {
    const schema = z.object({ value: z.string() });
    const result = await provider.generateStructured({
      messages: [],
      schema,
      schemaName: 'test',
      mockValue: { value: 'ok' },
    });
    expect(result.data.value).toBe('ok');
  });
});

describe('remote chat providers', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('always uses local embeddings without making a remote request', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const openai = createAIProvider({
      provider: 'openai',
      apiKey: 'test-secret',
      baseUrl: 'https://provider.invalid/v1',
      chatModel: 'test-chat',
      embeddingModel: 'test-embedding',
      embeddingDimensions: 3,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    const first = await openai.embed('lecture');
    const second = await openai.embed('lecture');
    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
    expect(openai.embeddingModel).toBe('local-hash-v1');
    expect(request).not.toHaveBeenCalled();
  });

  it('routes Groq chat through its OpenAI-compatible endpoint', async () => {
    const request = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            model: 'openai/gpt-oss-120b',
            choices: [{ message: { content: 'GROQ_TEST_OK' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', request);
    const groq = createAIProvider({
      provider: 'groq',
      apiKey: 'test-secret',
      chatModel: 'openai/gpt-oss-120b',
      embeddingModel: 'ignored',
      embeddingDimensions: 1536,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await expect(
      groq.chat({ messages: [{ role: 'user', content: 'test' }] }),
    ).resolves.toMatchObject({
      content: 'GROQ_TEST_OK',
      finishReason: 'stop',
    });
    expect(groq.name).toBe('groq');
    expect(request).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-secret' }),
      }),
    );
  });

  it('honors provider rate-limit reset headers before retrying', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0.001' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'RETRIED_OK' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', request);
    const groq = createAIProvider({
      provider: 'groq',
      apiKey: 'test-secret',
      chatModel: 'test-model',
      embeddingModel: 'ignored',
      embeddingDimensions: 1536,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 1,
    });
    await expect(
      groq.chat({ messages: [{ role: 'user', content: 'test' }] }),
    ).resolves.toMatchObject({
      content: 'RETRIED_OK',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('uses the official Gemini generateContent request and local embeddings', async () => {
    const request = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: 'GEMINI_TEST_OK' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
            modelVersion: 'gemini-2.5-flash',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', request);
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'gemini-test-secret',
      chatModel: 'gemini-2.5-flash',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await expect(
      gemini.chat({
        messages: [
          { role: 'system', content: 'Tutor instructions' },
          { role: 'user', content: 'Explain this' },
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Simplify it' },
        ],
      }),
    ).resolves.toMatchObject({
      content: 'GEMINI_TEST_OK',
      model: 'gemini-2.5-flash',
      finishReason: 'STOP',
      usage: { inputTokens: 12, outputTokens: 4 },
      providerRequests: 1,
    });
    expect(request).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-test-secret' }),
        body: expect.stringContaining('systemInstruction'),
      }),
    );
    expect(JSON.parse(request.mock.calls[0]![1].body as string)).toMatchObject({
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    });
    await expect(gemini.embed('local only')).resolves.toHaveLength(8);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('logs structured validation details and sends the invalid output in the correction request', async () => {
    const log = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"questions":[{"prompt":7,"index":0}]}' }] } }],
            modelVersion: 'gemini-test',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"questions":[{"prompt":"Fixed","index":0}]}' }] } }],
            modelVersion: 'gemini-test',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', request);
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'test-secret',
      chatModel: 'gemini-test',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 0,
      log,
    });
    await expect(
      gemini.generateStructured({
        messages: [],
        schema: z.object({
          questions: z
            .array(z.object({ prompt: z.string().min(5).max(200), index: z.number().int().nonnegative() }))
            .min(1)
            .max(30),
        }),
        schemaName: 'quiz',
        mockValue: { questions: [] },
      }),
    ).resolves.toMatchObject({ data: { questions: [{ prompt: 'Fixed' }] } });
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Invalid AI structured response',
      expect.objectContaining({
        schemaName: 'quiz',
        failureKind: 'schema_validation',
        rawResponsePreview: '{"questions":[{"prompt":7,"index":0}]}',
        validationIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'questions.0.prompt', message: 'Expected string, received number' }),
        ]),
      }),
    );
    const correctionBody = JSON.parse(request.mock.calls[1]![1].body as string);
    const initialBody = JSON.parse(request.mock.calls[0]![1].body as string);
    expect(initialBody.generationConfig.responseJsonSchema).toEqual({
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { prompt: { type: 'string' }, index: { type: 'integer' } },
            required: ['prompt', 'index'],
          },
        },
      },
      required: ['questions'],
    });
    expect(JSON.stringify(correctionBody)).toContain('questions.0.prompt');
    expect(JSON.stringify(correctionBody)).toContain(
      '{\\"questions\\":[{\\"prompt\\":7,\\"index\\":0}]}',
    );
    expect(JSON.stringify(correctionBody)).toContain('do not wrap it in a \\"quiz\\" property');
    expect(JSON.stringify(correctionBody)).toContain('REQUIRED_JSON_SCHEMA');
  });

  it('does not retry Gemini RESOURCE_EXHAUSTED and preserves RetryInfo', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                  retryDelay: '0.001s',
                },
              ],
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'RETRIED' }] } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', request);
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'test-secret',
      chatModel: 'gemini-2.5-flash',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 1,
    });
    await expect(gemini.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toEqual(
      expect.objectContaining<Partial<AIProviderError>>({
        code: 'RATE_LIMITED',
        retryAfterMs: 1,
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('prioritizes a daily quota ID over Gemini short RetryInfo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T09:02:05Z'));
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    quotaMetric:
                      'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                    quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                    quotaDimensions: { model: 'gemini-3.5-flash', location: 'global' },
                    quotaValue: '20',
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '55s',
              },
            ],
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', request);
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'test-secret',
      chatModel: 'gemini-3.5-flash',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 5,
    });

    await expect(gemini.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toEqual(
      expect.objectContaining<Partial<AIProviderError>>({
        code: 'RATE_LIMITED',
        retryable: false,
        retryAfterMs: 79_075_000,
        rateLimitScope: 'DAY',
        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('preserves Gemini retry timing when RESOURCE_EXHAUSTED remains', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                  retryDelay: '17.2s',
                },
              ],
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'test-secret',
      chatModel: 'gemini-3.5-flash',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await expect(gemini.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toEqual(
      expect.objectContaining<Partial<AIProviderError>>({
        code: 'RATE_LIMITED',
        retryable: false,
        retryAfterMs: 17_200,
      }),
    );
  });

  it('never retries Gemini 429 even when general retries are configured', async () => {
    const request = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                  retryDelay: '59s',
                },
              ],
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', request);
    const gemini = createAIProvider({
      provider: 'gemini',
      apiKey: 'test-secret',
      chatModel: 'gemini-3.5-flash',
      embeddingModel: 'ignored',
      embeddingDimensions: 8,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRetries: 5,
    });

    await expect(gemini.chat({ messages: [{ role: 'user', content: 'test' }] })).rejects.toEqual(
      expect.objectContaining<Partial<AIProviderError>>({
        code: 'RATE_LIMITED',
        retryAfterMs: 59_000,
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});
