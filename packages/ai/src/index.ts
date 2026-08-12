import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
export {
  loadAIEnvironment,
  loadRootEnvironment,
  rootEnvPath,
  safeAIStartupLines,
} from './environment.js';
export type { AIEnvironment } from './environment.js';

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AIUsage = { inputTokens?: number | undefined; outputTokens?: number | undefined };
export type ChatResult = {
  content: string;
  model: string;
  finishReason?: string | undefined;
  usage?: AIUsage;
  providerRequests?: number;
};
export type AIProviderName = 'mock' | 'openai' | 'groq' | 'gemini';

export interface AIProvider {
  readonly name: AIProviderName;
  readonly chatModel: string;
  readonly embeddingModel: string;
  chat(input: { messages: AIMessage[]; maxOutputTokens?: number }): Promise<ChatResult>;
  generateStructured<T>(input: {
    messages: AIMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
    maxOutputTokens?: number;
    mockValue: T | (() => T);
  }): Promise<{ data: T; model: string; usage?: AIUsage; providerRequests?: number }>;
  embed(input: string): Promise<number[]>;
  embedBatch(input: string[]): Promise<number[][]>;
}

export class AIProviderError extends Error {
  constructor(
    public readonly code:
      'CONFIGURATION' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_OUTPUT' | 'RATE_LIMITED',
    message: string,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
    public readonly rateLimitScope?: 'MINUTE' | 'DAY',
    public readonly quotaId?: string,
    public readonly providerRequests?: number,
  ) {
    super(message);
  }
}

export type AIProviderConfig = {
  provider: AIProviderName;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  temperature?: number | undefined;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  log?:
    | ((
        level: 'info' | 'warn' | 'error',
        message: string,
        metadata?: Record<string, unknown>,
      ) => void)
    | undefined;
};

function deterministicVector(text: string, dimensions: number) {
  const vector = new Array<number>(dimensions).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    vector[Math.abs(hash) % dimensions]! += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function readableDemoText(text: string) {
  const cleaned = text.trim();
  if (/\n\s*\n|^#{1,6}\s|^[-*]\s/m.test(cleaned)) return cleaned;
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [cleaned];
  return Array.from({ length: Math.ceil(sentences.length / 3) }, (_, index) =>
    sentences
      .slice(index * 3, index * 3 + 3)
      .join(' ')
      .trim(),
  ).join('\n\n');
}

export class MockAIProvider implements AIProvider {
  readonly name = 'mock' as const;
  readonly chatModel: string;
  readonly embeddingModel: string;
  constructor(private readonly config: AIProviderConfig) {
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;
  }
  async chat(input: { messages: AIMessage[] }): Promise<ChatResult> {
    const system = input.messages.find((message) => message.role === 'system')?.content ?? '';
    const context = system.match(/<course_context>([\s\S]*?)<\/course_context>/)?.[1]?.trim();
    if (!context)
      return {
        content: 'Demo AI: no indexed course context was available.',
        model: this.chatModel,
      };
    const excerpts = context.split(/\n\s*\n(?=DOCUMENT:)/).slice(0, 12);
    const sections = new Map<string, { marker: string; source: string; previews: string[] }>();
    for (const excerpt of excerpts) {
      const source = excerpt.match(/^DOCUMENT:\s*(.+)$/m)?.[1]?.trim() ?? 'Course material';
      const section = excerpt.match(/^SECTION:\s*(.+)$/m)?.[1]?.trim();
      const marker = excerpt.match(/^SOURCE_MARKER:\s*\[(S\d+)\]/m)?.[1] ?? '';
      const body = excerpt.split(/^CONTENT:\s*$/m)[1]?.trim() ?? '';
      const label = section && !section.startsWith('Uncertain') ? section : source;
      const preview = body
        .replace(/^#{1,6}\s+.*$/gm, '')
        .split(/\n\s*\n/)
        .find((part) => part.trim())
        ?.trim()
        .slice(0, 360);
      if (!preview) continue;
      const group = sections.get(label) ?? { marker, source, previews: [] };
      if (!group.previews.includes(preview)) group.previews.push(preview);
      sections.set(label, group);
    }
    return {
      content: `> **Demo mode:** Remote AI is not configured. This is an organized source outline, not a generated AI tutor explanation.\n\n# Source Outline\n\n${[
        ...sections,
      ]
        .map(
          ([heading, group]) =>
            `## ${heading}\n\n${group.previews.map((preview) => `${readableDemoText(preview)}${group.marker ? ` [${group.marker}]` : ''}`).join('\n\n')}`,
        )
        .join('\n\n')
        .slice(0, 7000)}`,
      model: this.chatModel,
      providerRequests: 0,
    };
  }
  async generateStructured<T>(input: { schema: z.ZodType<T>; mockValue: T | (() => T) }) {
    const value =
      typeof input.mockValue === 'function' ? (input.mockValue as () => T)() : input.mockValue;
    return { data: input.schema.parse(value), model: this.chatModel, providerRequests: 0 };
  }
  async embed(input: string) {
    return deterministicVector(input, this.config.embeddingDimensions);
  }
  async embedBatch(input: string[]) {
    return input.map((text) => deterministicVector(text, this.config.embeddingDimensions));
  }
}

type OpenAIErrorBody = { error?: { message?: string; type?: string; code?: string } };

function providerRetryDelayMs(headers: Headers) {
  const retryAfter = headers.get('retry-after');
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Number(retryAfter) * 1000;
  const reset =
    headers.get('x-ratelimit-reset-tokens') ?? headers.get('x-ratelimit-reset-requests');
  if (!reset) return undefined;
  const match = reset.match(/^([\d.]+)(ms|s|m)?$/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return (
    value * (match[2]?.toLowerCase() === 'ms' ? 1 : match[2]?.toLowerCase() === 'm' ? 60_000 : 1000)
  );
}

function durationMs(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^([\d.]+)(ms|s|m)?$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return (
    amount *
    (match[2]?.toLowerCase() === 'ms' ? 1 : match[2]?.toLowerCase() === 'm' ? 60_000 : 1000)
  );
}

const STRUCTURED_OUTPUT_LOG_PREVIEW_CHARACTERS = 1_000;
const STRUCTURED_OUTPUT_CORRECTION_CHARACTERS = 24_000;

function structuredOutputFailure(error: unknown) {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '$',
      code: issue.code,
      message: issue.message,
    }));
    return {
      kind: 'schema_validation' as const,
      message: issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      issues,
    };
  }
  return {
    kind: 'json_parse' as const,
    message: error instanceof Error ? error.message : String(error),
    issues: [],
  };
}

function geminiResponseJsonSchema(schema: z.ZodType<unknown>) {
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  // Keep the wire schema deliberately smaller than the full JSON Schema emitted by Zod.
  // Gemini validates the final value only against a subset; Zod remains the authority for
  // length, range, unknown-key, and other application constraints after generation.
  const supportedKeywords = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'title',
    'description',
  ]);
  const sanitize = (value: unknown, parentKey?: string): unknown => {
    if (Array.isArray(value)) return value.map((child) => sanitize(child));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // Property names are user-defined, so only filter keys that are schema keywords.
        .filter(([key]) => parentKey === 'properties' || supportedKeywords.has(key))
        .map(([key, child]) => [key, sanitize(child, key)]),
    );
  };
  return sanitize(jsonSchema) as Record<string, unknown>;
}

function structuredOutputCorrection(
  raw: string,
  failure: ReturnType<typeof structuredOutputFailure>,
  schemaName: string,
  responseSchema?: Record<string, unknown>,
) {
  const retained = raw.slice(0, STRUCTURED_OUTPUT_CORRECTION_CHARACTERS);
  const truncation = retained.length < raw.length ? '\n[invalid output truncated]' : '';
  const schemaInstruction = responseSchema
    ? `\n\nREQUIRED_JSON_SCHEMA:\n${JSON.stringify(responseSchema)}`
    : '';
  return `Correct the structured output below and return JSON only. Preserve valid content while fixing every listed error. Return the schema's object directly; do not wrap it in a "${schemaName}" property.${schemaInstruction}\n\nVALIDATION_ERRORS:\n${failure.message}\n\nINVALID_OUTPUT:\n${retained}${truncation}`;
}

function logStructuredOutputFailure(
  config: AIProviderConfig,
  provider: AIProviderName,
  model: string,
  schemaName: string,
  attempt: number,
  raw: string,
  failure: ReturnType<typeof structuredOutputFailure>,
) {
  config.log?.('warn', 'Invalid AI structured response', {
    provider,
    model,
    schemaName,
    attempt,
    failureKind: failure.kind,
    validationMessage: failure.message,
    validationIssues: failure.issues,
    rawResponseLength: raw.length,
    rawResponsePreview: raw.slice(0, STRUCTURED_OUTPUT_LOG_PREVIEW_CHARACTERS),
  });
}

export class OpenAIProvider implements AIProvider {
  readonly name: 'openai' | 'groq';
  readonly chatModel: string;
  readonly embeddingModel: string;
  private readonly baseUrl: string;
  constructor(
    private readonly config: AIProviderConfig,
    providerName: 'openai' | 'groq' = 'openai',
  ) {
    if (!config.apiKey)
      throw new AIProviderError(
        'CONFIGURATION',
        'AI_API_KEY is required when AI_PROVIDER is openai or groq.',
      );
    this.name = providerName;
    this.chatModel = config.chatModel;
    this.embeddingModel = 'local-hash-v1';
    this.baseUrl = (
      config.baseUrl ??
      (providerName === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1')
    ).replace(/\/$/, '');
  }
  private async request<T>(path: string, body: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let retryDelayMs: number | undefined;
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (response.ok) return (await response.json()) as T;
        const errorBody = (await response.json().catch(() => ({}))) as OpenAIErrorBody;
        const retryable =
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500;
        retryDelayMs = response.status === 429 ? providerRetryDelayMs(response.headers) : undefined;
        if (!retryable || attempt === this.config.maxRetries)
          throw new AIProviderError(
            response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            'The AI provider could not complete the request.',
            retryable,
            retryDelayMs,
          );
        this.config.log?.('warn', 'Transient AI provider response', {
          status: response.status,
          attempt,
          providerCode: errorBody.error?.code,
          providerType: errorBody.error?.type,
          retryAfterMs: retryDelayMs,
          rateLimitLimitRequests: response.headers.get('x-ratelimit-limit-requests'),
          rateLimitRemainingRequests: response.headers.get('x-ratelimit-remaining-requests'),
          rateLimitResetRequests: response.headers.get('x-ratelimit-reset-requests'),
          rateLimitLimitTokens: response.headers.get('x-ratelimit-limit-tokens'),
          rateLimitRemainingTokens: response.headers.get('x-ratelimit-remaining-tokens'),
          rateLimitResetTokens: response.headers.get('x-ratelimit-reset-tokens'),
        });
      } catch (error) {
        lastError = error;
        if (error instanceof AIProviderError && !error.retryable) throw error;
        if (attempt === this.config.maxRetries) {
          if (error instanceof DOMException && error.name === 'TimeoutError')
            throw new AIProviderError('TIMEOUT', 'The AI request timed out.', true);
          throw error instanceof AIProviderError
            ? error
            : new AIProviderError(
                'UNAVAILABLE',
                'The AI provider is temporarily unavailable.',
                true,
              );
        }
      }
      const fallbackDelay = 400 * 2 ** attempt + Math.random() * 150;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(Math.max(retryDelayMs ?? 0, fallbackDelay), 30_000)),
      );
    }
    throw lastError;
  }
  async chat(input: { messages: AIMessage[]; maxOutputTokens?: number }): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.chatModel,
      messages: input.messages,
      max_completion_tokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
    };
    if (this.config.temperature !== undefined) body.temperature = this.config.temperature;
    const result = await this.request<{
      choices: { message: { content: string | null }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    }>('/chat/completions', body);
    const content = result.choices[0]?.message.content?.trim();
    if (!content)
      throw new AIProviderError('INVALID_OUTPUT', 'The AI provider returned an empty response.');
    return {
      content,
      model: result.model ?? this.chatModel,
      finishReason: result.choices[0]?.finish_reason,
      usage: {
        inputTokens: result.usage?.prompt_tokens,
        outputTokens: result.usage?.completion_tokens,
      },
    };
  }
  async generateStructured<T>(input: {
    messages: AIMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
    maxOutputTokens?: number;
    mockValue: T | (() => T);
  }) {
    const messages = [
      ...input.messages,
      {
        role: 'system' as const,
        content: `Return only one valid JSON object matching the requested ${input.schemaName} structure. Do not include markdown fences.`,
      },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.request<{
        choices: { message: { content: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      }>('/chat/completions', {
        model: this.chatModel,
        messages,
        response_format: { type: 'json_object' },
        max_completion_tokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
      });
      const raw = result.choices[0]?.message.content;
      try {
        return {
          data: input.schema.parse(JSON.parse(raw ?? '')),
          model: result.model ?? this.chatModel,
          usage: {
            inputTokens: result.usage?.prompt_tokens,
            outputTokens: result.usage?.completion_tokens,
          },
        };
      } catch (error) {
        const failure = structuredOutputFailure(error);
        logStructuredOutputFailure(
          this.config,
          this.name,
          result.model ?? this.chatModel,
          input.schemaName,
          attempt + 1,
          raw ?? '',
          failure,
        );
        if (attempt === 1)
          throw new AIProviderError(
            'INVALID_OUTPUT',
            'The AI provider returned invalid structured data.',
          );
        messages.push({
          role: 'user',
          content: structuredOutputCorrection(raw ?? '', failure, input.schemaName),
        });
      }
    }
    throw new AIProviderError(
      'INVALID_OUTPUT',
      'The AI provider returned invalid structured data.',
    );
  }
  async embed(input: string) {
    return deterministicVector(input, this.config.embeddingDimensions);
  }
  async embedBatch(input: string[]) {
    return input.map((text) => deterministicVector(text, this.config.embeddingDimensions));
  }
}

type GeminiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      '@type'?: string;
      retryDelay?: string;
      violations?: Array<{
        quotaMetric?: string;
        quotaId?: string;
        quotaDimensions?: Record<string, string>;
        quotaValue?: string;
      }>;
    }>;
  };
};

export const pacificDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

export function pacificMidnight(year: number, month: number, day: number) {
  const desired = Date.UTC(year, month - 1, day);
  let instant = desired;
  for (let iteration = 0; iteration < 4; iteration++) {
    const represented = pacificDateParts(new Date(instant));
    instant +=
      desired -
      Date.UTC(
        represented.year,
        represented.month - 1,
        represented.day,
        represented.hour,
        represented.minute,
        represented.second,
      );
  }
  return new Date(instant);
}

export function nextPacificMidnight(now = new Date()) {
  const current = pacificDateParts(now);
  const nextDate = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  return pacificMidnight(
    nextDate.getUTCFullYear(),
    nextDate.getUTCMonth() + 1,
    nextDate.getUTCDate(),
  );
}

export function pacificRangeStart(now = new Date(), days = 1) {
  const current = pacificDateParts(now);
  const startDate = new Date(Date.UTC(current.year, current.month - 1, current.day - (days - 1)));
  return pacificMidnight(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth() + 1,
    startDate.getUTCDate(),
  );
}

export function msUntilNextPacificMidnight(now = new Date()) {
  return Math.max(1000, nextPacificMidnight(now).getTime() - now.getTime());
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
};

function geminiRequest(messages: AIMessage[], generationConfig: Record<string, unknown>) {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const message of messages.filter((item) => item.role !== 'system')) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const previous = contents.at(-1);
    if (previous?.role === role) previous.parts.push({ text: message.content });
    else contents.push({ role, parts: [{ text: message.content }] });
  }
  return {
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig,
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  readonly chatModel: string;
  readonly embeddingModel = 'local-hash-v1';
  private readonly baseUrl: string;

  constructor(private readonly config: AIProviderConfig) {
    if (!config.apiKey)
      throw new AIProviderError('CONFIGURATION', 'AI_API_KEY is required for Gemini.');
    this.chatModel = config.chatModel;
    this.baseUrl = (config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/,
      '',
    );
  }

  private async request(body: unknown): Promise<{
    response: GeminiResponse;
    providerRequests: number;
  }> {
    let lastError: unknown;
    const requestStartedAt = performance.now();
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const attemptStartedAt = performance.now();
      let retryDelayMs: number | undefined;
      try {
        const response = await fetch(
          `${this.baseUrl}/models/${encodeURIComponent(this.chatModel)}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey! },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeoutMs),
          },
        );
        if (response.ok) {
          const result = (await response.json()) as GeminiResponse;
          this.config.log?.('info', 'Gemini provider request completed', {
            attempt: attempt + 1,
            retries: attempt,
            attemptMs: Math.round(performance.now() - attemptStartedAt),
            totalMs: Math.round(performance.now() - requestStartedAt),
            model: this.chatModel,
            thinkingLevel: 'low',
            promptTokens: result.usageMetadata?.promptTokenCount,
            outputTokens: result.usageMetadata?.candidatesTokenCount,
            thinkingTokens: result.usageMetadata?.thoughtsTokenCount,
            totalTokens: result.usageMetadata?.totalTokenCount,
          });
          return { response: result, providerRequests: attempt + 1 };
        }
        const errorBody = (await response.json().catch(() => ({}))) as GeminiErrorBody;
        const retryInfo = errorBody.error?.details?.find((detail) =>
          detail['@type']?.endsWith('google.rpc.RetryInfo'),
        );
        const quotaViolation = errorBody.error?.details?.find((detail) =>
          detail['@type']?.endsWith('google.rpc.QuotaFailure'),
        )?.violations?.[0];
        const dailyQuota = quotaViolation?.quotaId?.includes('PerDay') ?? false;
        retryDelayMs = dailyQuota
          ? msUntilNextPacificMidnight()
          : (durationMs(retryInfo?.retryDelay) ?? providerRetryDelayMs(response.headers));
        const retryable = response.status === 408 || response.status >= 500;
        this.config.log?.('warn', 'Transient Gemini provider response', {
          status: response.status,
          attempt,
          providerCode: errorBody.error?.code,
          providerStatus: errorBody.error?.status,
          providerMessage: errorBody.error?.message?.slice(0, 500),
          providerHost: new URL(this.baseUrl).host,
          model: this.chatModel,
          retryAfterMs: retryDelayMs,
          retryAfter: response.headers.get('retry-after'),
          googleRequestId: response.headers.get('x-request-id'),
          quotaId: quotaViolation?.quotaId,
          quotaMetric: quotaViolation?.quotaMetric,
          quotaValue: quotaViolation?.quotaValue,
          quotaDimensions: quotaViolation?.quotaDimensions,
          rateLimitScope: dailyQuota ? 'DAY' : 'MINUTE',
        });
        if (!retryable || attempt === this.config.maxRetries)
          throw new AIProviderError(
            response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            `Gemini could not complete the request (${errorBody.error?.status ?? response.status}).`,
            retryable,
            retryDelayMs,
            dailyQuota ? 'DAY' : 'MINUTE',
            quotaViolation?.quotaId,
            attempt + 1,
          );
      } catch (error) {
        lastError = error;
        if (!(error instanceof AIProviderError))
          this.config.log?.('warn', 'Gemini provider request failed', {
            attempt: attempt + 1,
            attemptMs: Math.round(performance.now() - attemptStartedAt),
            model: this.chatModel,
            error: error instanceof Error ? error.message : String(error),
          });
        if (error instanceof AIProviderError && !error.retryable) throw error;
        if (attempt === this.config.maxRetries) {
          if (error instanceof DOMException && error.name === 'TimeoutError')
            throw new AIProviderError(
              'TIMEOUT',
              'The Gemini request timed out.',
              true,
              undefined,
              undefined,
              undefined,
              attempt + 1,
            );
          throw error instanceof AIProviderError
            ? error
            : new AIProviderError(
                'UNAVAILABLE',
                'Gemini is temporarily unavailable.',
                true,
                undefined,
                undefined,
                undefined,
                attempt + 1,
              );
        }
      }
      const fallbackDelay = 1000 * 2 ** attempt + Math.random() * 250;
      const appliedDelayMs = Math.min(Math.max(retryDelayMs ?? 0, fallbackDelay), 60_000);
      this.config.log?.('warn', 'Retrying Gemini provider request', {
        completedAttempt: attempt + 1,
        nextAttempt: attempt + 2,
        attemptMs: Math.round(performance.now() - attemptStartedAt),
        appliedDelayMs: Math.round(appliedDelayMs),
      });
      await new Promise((resolve) => setTimeout(resolve, appliedDelayMs));
    }
    throw lastError;
  }

  async chat(input: { messages: AIMessage[]; maxOutputTokens?: number }): Promise<ChatResult> {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
      thinkingConfig: { thinkingLevel: 'low' },
    };
    if (this.config.temperature !== undefined && !/^gemini-3(?:\.|-)/.test(this.chatModel))
      generationConfig.temperature = this.config.temperature;
    const request = await this.request(geminiRequest(input.messages, generationConfig));
    const result = request.response;
    const candidate = result.candidates?.[0];
    const content = candidate?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!content)
      throw new AIProviderError(
        'INVALID_OUTPUT',
        `Gemini returned no text${result.promptFeedback?.blockReason ? ` (${result.promptFeedback.blockReason})` : ''}.`,
      );
    return {
      content,
      model: result.modelVersion ?? this.chatModel,
      finishReason: candidate?.finishReason === 'MAX_TOKENS' ? 'length' : candidate?.finishReason,
      usage: {
        inputTokens: result.usageMetadata?.promptTokenCount,
        outputTokens: result.usageMetadata?.candidatesTokenCount,
      },
      providerRequests: request.providerRequests,
    };
  }

  async generateStructured<T>(input: {
    messages: AIMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
    maxOutputTokens?: number;
  }) {
    const responseJsonSchema = geminiResponseJsonSchema(input.schema);
    const messages = [
      ...input.messages,
      {
        role: 'user' as const,
        content: `Return the JSON object described by the response schema directly. Do not wrap it in a "${input.schemaName}" property.`,
      },
    ];
    let providerRequests = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = await this.request(
        geminiRequest(messages, {
          maxOutputTokens: input.maxOutputTokens ?? this.config.maxOutputTokens,
          responseMimeType: 'application/json',
          responseJsonSchema,
          thinkingConfig: { thinkingLevel: 'low' },
          ...(this.config.temperature !== undefined && !/^gemini-3(?:\.|-)/.test(this.chatModel)
            ? { temperature: this.config.temperature }
            : {}),
        }),
      );
      providerRequests += request.providerRequests;
      const result = request.response;
      const raw = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
      try {
        return {
          data: input.schema.parse(JSON.parse(raw ?? '')),
          model: result.modelVersion ?? this.chatModel,
          usage: {
            inputTokens: result.usageMetadata?.promptTokenCount,
            outputTokens: result.usageMetadata?.candidatesTokenCount,
          },
          providerRequests,
        };
      } catch (error) {
        const failure = structuredOutputFailure(error);
        logStructuredOutputFailure(
          this.config,
          this.name,
          result.modelVersion ?? this.chatModel,
          input.schemaName,
          attempt + 1,
          raw ?? '',
          failure,
        );
        if (attempt === 1)
          throw new AIProviderError(
            'INVALID_OUTPUT',
            'Gemini returned invalid structured data.',
            false,
            undefined,
            undefined,
            undefined,
            providerRequests,
          );
        messages.push({
          role: 'user',
          content: structuredOutputCorrection(
            raw ?? '',
            failure,
            input.schemaName,
            responseJsonSchema,
          ),
        });
      }
    }
    throw new AIProviderError(
      'INVALID_OUTPUT',
      'Gemini returned invalid structured data.',
      false,
      undefined,
      undefined,
      undefined,
      providerRequests,
    );
  }

  async embed(input: string) {
    return deterministicVector(input, this.config.embeddingDimensions);
  }
  async embedBatch(input: string[]) {
    return input.map((text) => deterministicVector(text, this.config.embeddingDimensions));
  }
}

export function createAIProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === 'mock') return new MockAIProvider(config);
  if (config.provider === 'gemini') return new GeminiProvider(config);
  return new OpenAIProvider(config, config.provider);
}
