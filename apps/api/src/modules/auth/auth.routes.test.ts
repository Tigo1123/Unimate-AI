import type { Request, Response } from 'express';
import argon2 from 'argon2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma.js';
import { registerAccount } from './auth.routes.js';

describe('registration welcome email', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('succeeds and triggers exactly one welcome email when Resend fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(argon2, 'hash').mockResolvedValue('password-hash');
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.user, 'create').mockResolvedValue({
      id: '02d6fb22-9f06-43f1-bb2c-19d8436a81b4',
      email: 'student@example.com',
      role: 'STUDENT',
      profile: { fullName: 'Aline Student' },
      onboardingCompletedAt: null,
    } as never);
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({
      id: '77e8fc52-23ea-4eb6-a221-d518c81bb895',
    } as never);
    vi.spyOn(prisma.authSession, 'update').mockResolvedValue({} as never);
    const request = {
      body: {
        email: 'student@example.com',
        password: 'correct-password',
        fullName: 'Aline Student',
      },
      header: vi.fn().mockReturnValue('test-agent'),
    } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const response = { status, cookie: vi.fn() } as unknown as Response;

    await registerAccount(request, response);
    await new Promise((resolve) => setImmediate(resolve));

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ user: expect.anything() }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('labels the shared-domain restriction as a known limitation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'You can only send testing emails to your own email address.',
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.spyOn(argon2, 'hash').mockResolvedValue('password-hash');
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.user, 'create').mockResolvedValue({
      id: 'c662b816-b13c-4f03-93cc-c9cf11e553f1',
      email: 'another-student@example.com',
      role: 'STUDENT',
      profile: { fullName: 'Another Student' },
      onboardingCompletedAt: null,
    } as never);
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({
      id: 'f7de4f93-e46a-42cc-a755-55be2efd7a0c',
    } as never);
    vi.spyOn(prisma.authSession, 'update').mockResolvedValue({} as never);
    const request = {
      body: {
        email: 'another-student@example.com',
        password: 'correct-password',
        fullName: 'Another Student',
      },
      header: vi.fn().mockReturnValue('test-agent'),
    } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });

    await registerAccount(request, {
      status,
      cookie: vi.fn(),
    } as unknown as Response);
    await new Promise((resolve) => setImmediate(resolve));

    expect(status).toHaveBeenCalledWith(201);
    expect(warning).toHaveBeenCalledWith(
      'Welcome email skipped: known Resend shared-domain limitation',
      expect.objectContaining({
        limitation: 'RESEND_TEST_DOMAIN_RECIPIENT_RESTRICTION',
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });
});
