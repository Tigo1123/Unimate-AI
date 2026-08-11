import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/error-handler.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { coreRouter } from './modules/core/core.routes.js';
import { sourceRouter } from './modules/sources/source.routes.js';
import { studyRouter } from './modules/study/study.routes.js';
import { aiUsageRouter } from './modules/ai-usage/ai-usage.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(requestId);
app.use(
  pinoHttp({
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
  }),
);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(
  '/api/v1',
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }),
);
app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30 }), authRouter);
app.use('/api/v1', requireAuth, coreRouter, sourceRouter, studyRouter, aiUsageRouter);
app.use(notFoundHandler);
app.use(errorHandler);
