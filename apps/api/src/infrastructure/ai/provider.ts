import { createAIProvider } from '@unimate/ai';
import { env } from '../../config/env.js';
import { writeAiTelemetry } from '../observability/ai-telemetry.js';

export const aiProvider = createAIProvider({
  provider: env.AI_PROVIDER,
  apiKey: env.AI_API_KEY,
  baseUrl: env.AI_BASE_URL,
  chatModel: env.AI_MODEL,
  embeddingModel: env.EMBEDDING_MODEL,
  embeddingDimensions: env.EMBEDDING_DIMENSIONS,
  temperature: env.AI_TEMPERATURE,
  maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
  timeoutMs: env.AI_TIMEOUT_MS,
  maxRetries: env.AI_MAX_RETRIES,
  log: (level, message, metadata) => {
    writeAiTelemetry(level, message, metadata ?? {});
    if (level === 'error') console.error(message, metadata);
    else if (level === 'warn') console.warn(message, metadata);
    else console.info(message, metadata);
  },
});
