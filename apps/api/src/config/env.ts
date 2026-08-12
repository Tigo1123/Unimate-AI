import { loadAIEnvironment, loadRootEnvironment } from '@unimate/ai';
import { loadStorageEnvironment } from '@unimate/storage';
import { z } from 'zod';

const rootEnvironment = loadRootEnvironment();
const aiEnvironment = loadAIEnvironment(rootEnvironment);
const storageEnvironment = loadStorageEnvironment({ ...rootEnvironment, ...process.env });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(30),
  RAG_TOP_K: z.coerce.number().int().min(2).max(20).default(8),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(25),
  MAX_SOURCES_PER_COURSE: z.coerce.number().int().positive().default(50),
  RESEND_API_KEY: z.string().trim().min(1),
  EMAIL_FROM: z.string().trim().min(1),
});

export const env = {
  ...schema.parse({ ...rootEnvironment, ...process.env }),
  ...aiEnvironment,
  ...storageEnvironment,
};
