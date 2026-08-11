import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const rootEnvPath = path.join(rootDirectory, '.env');

const aiEnvironmentSchema = z
  .object({
    AI_PROVIDER: z.enum(['mock', 'openai', 'groq', 'gemini']),
    AI_MODEL: z.string().trim().min(1),
    EMBEDDING_MODEL: z.string().trim().min(1),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
    AI_API_KEY: z.string().trim().optional(),
    AI_BASE_URL: z.string().url().optional(),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32_000).default(4000),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  })
  .superRefine((value, context) => {
    if (value.AI_PROVIDER !== 'mock' && !value.AI_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_API_KEY'],
        message: 'AI_API_KEY is required when AI_PROVIDER is openai, groq, or gemini.',
      });
    }
  });

export type AIEnvironment = z.infer<typeof aiEnvironmentSchema>;

export function loadRootEnvironment(): Record<string, string> {
  const rootValues: Record<string, string> = {};
  const result = loadDotenv({ path: rootEnvPath, processEnv: rootValues });
  if (result.error) throw new Error(`Unable to load the root environment file at ${rootEnvPath}.`);
  return rootValues;
}

export function loadAIEnvironment(rootEnvironment = loadRootEnvironment()): AIEnvironment {
  // Root AI values deliberately win over workspace-local values loaded as import
  // side effects. Other runtime settings can still be overridden by the process.
  const environment = aiEnvironmentSchema.parse({ ...process.env, ...rootEnvironment });
  if (environment.EMBEDDING_DIMENSIONS !== 1536) {
    throw new Error('EMBEDDING_DIMENSIONS must remain 1536 for the current pgvector schema.');
  }
  return environment;
}

export function safeAIStartupLines(environment: AIEnvironment) {
  return [
    `AI provider: ${environment.AI_PROVIDER}`,
    `AI model: ${environment.AI_MODEL}`,
    'Embedding provider: local hash-based fallback',
    `API key configured: ${environment.AI_API_KEY ? 'yes' : 'no'}`,
  ];
}
