import type { ErrorRequestHandler, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/app-error.js';
import { AIProviderError } from '@unimate/ai';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'Route not found.'));

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred.';
  let details: Record<string, unknown> | undefined;
  if (error instanceof AppError) ({ status, code, message, details } = error);
  if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = error.issues.map((issue) => issue.message).join(', ');
  }
  if (error instanceof MulterError) {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = error.message;
  }
  if (error instanceof AIProviderError) {
    status =
      error.code === 'RATE_LIMITED'
        ? 429
        : error.code === 'CONFIGURATION'
          ? 503
          : error.code === 'INVALID_OUTPUT'
            ? 502
            : 503;
    code = `AI_${error.code}`;
    details = error.retryAfterMs
      ? {
          retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
          ...(error.rateLimitScope ? { rateLimitScope: error.rateLimitScope } : {}),
        }
      : undefined;
    message =
      error.code === 'RATE_LIMITED'
        ? error.rateLimitScope === 'DAY'
          ? "Gemini's free daily quota is exhausted. AI generation will be available after the daily quota resets at midnight Pacific time."
          : `You're asking questions quickly! Please wait about ${details?.retryAfterSeconds ?? 'a few'} seconds before your next question.`
        : error.code === 'TIMEOUT'
          ? 'The AI tutor timed out. Please retry.'
          : error.code === 'INVALID_OUTPUT'
            ? 'The AI tutor returned an invalid response. Please retry.'
            : error.code === 'CONFIGURATION'
              ? error.message
              : 'The AI tutor is temporarily unavailable. Please retry.';
  }
  if (status >= 500) req.log?.error?.({ err: error, requestId: req.requestId }, 'request failed');
  res
    .status(status)
    .json({ success: false, error: { code, message, requestId: req.requestId, ...details } });
};
