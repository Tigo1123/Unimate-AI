import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../shared/errors/app-error.js';
import { requireAuth } from './auth.js';

describe('requireAuth', () => {
  it('returns a controlled authentication error when credentials are absent', () => {
    const request = { header: vi.fn().mockReturnValue(undefined) } as unknown as Request;
    expect(() => requireAuth(request, {} as Response, vi.fn() as NextFunction)).toThrowError(
      expect.objectContaining<Partial<AppError>>({ status: 401, code: 'AUTH_REQUIRED' }),
    );
  });

  it('returns a controlled authentication error for an invalid token', () => {
    const request = { header: vi.fn().mockReturnValue('Bearer invalid') } as unknown as Request;
    expect(() => requireAuth(request, {} as Response, vi.fn() as NextFunction)).toThrowError(
      expect.objectContaining<Partial<AppError>>({ status: 401, code: 'INVALID_TOKEN' }),
    );
  });
});
