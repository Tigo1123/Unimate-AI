import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../shared/errors/app-error.js';
import { errorHandler } from './error-handler.js';
import { AIProviderError } from '@unimate/ai';

describe('errorHandler', () => {
  it('returns an accurate student-facing wait time for AI rate limits', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const request = { requestId: 'request-123', log: { error: vi.fn() } } as unknown as Request;
    const response = { status } as unknown as Response;
    errorHandler(
      new AppError(
        429,
        'AI_RATE_LIMITED',
        "You're asking questions quickly! Please wait about 18 seconds before your next question.",
        { retryAfterSeconds: 18 },
      ),
      request,
      response,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'AI_RATE_LIMITED',
        message:
          "You're asking questions quickly! Please wait about 18 seconds before your next question.",
        requestId: 'request-123',
        retryAfterSeconds: 18,
      },
    });
  });

  it('identifies an exhausted daily Gemini quota instead of promising a short retry', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const request = { requestId: 'daily-request', log: { error: vi.fn() } } as unknown as Request;
    const response = { status } as unknown as Response;
    errorHandler(
      new AIProviderError(
        'RATE_LIMITED',
        'Gemini quota exhausted.',
        false,
        79_075_000,
        'DAY',
        'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
      ),
      request,
      response,
      vi.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'AI_RATE_LIMITED',
        message:
          "Gemini's free daily quota is exhausted. AI generation will be available after the daily quota resets at midnight Pacific time.",
        requestId: 'daily-request',
        retryAfterSeconds: 79_075,
        rateLimitScope: 'DAY',
      },
    });
  });
});
