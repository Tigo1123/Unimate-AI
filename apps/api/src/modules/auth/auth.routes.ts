import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { loginSchema, registerSchema } from '@unimate/contracts';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { dispatchWelcomeEmail } from '../../infrastructure/email/welcome-email.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../shared/errors/app-error.js';
import { ok } from '../../shared/http/respond.js';

const router = Router();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cookie = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
};

function accessToken(user: { id: string; role: 'STUDENT' | 'ADMIN' }) {
  return jwt.sign({ role: user.role, type: 'access' }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL as any,
  });
}

async function issueSession(user: { id: string; role: 'STUDENT' | 'ADMIN' }, userAgent?: string) {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const session = await prisma.authSession.create({
    data: { userId: user.id, refreshTokenHash: 'pending', expiresAt, userAgent: userAgent ?? null },
  });
  const refreshToken = jwt.sign({ sid: session.id, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
  await prisma.authSession.update({
    where: { id: session.id },
    data: { refreshTokenHash: hash(refreshToken) },
  });
  return { accessToken: accessToken(user), refreshToken, expiresAt };
}

export async function registerAccount(req: Request, res: Response) {
  const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
  if (existing) throw new AppError(409, 'EMAIL_IN_USE', 'An account already uses this email.');
  const user = await prisma.user.create({
    data: {
      email: req.body.email,
      passwordHash: await argon2.hash(req.body.password),
      profile: { create: { fullName: req.body.fullName } },
    },
    select: { id: true, email: true, role: true, profile: true, onboardingCompletedAt: true },
  });
  const tokens = await issueSession(user, req.header('user-agent'));
  res.cookie('unimate_refresh', tokens.refreshToken, { ...cookie, expires: tokens.expiresAt });
  ok(res, { user, accessToken: tokens.accessToken }, 201);
  dispatchWelcomeEmail({
    userId: user.id,
    email: user.email,
    fullName: req.body.fullName,
  });
}

router.post('/register', validate(registerSchema), registerAccount);

router.post('/login', validate(loginSchema), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { email: req.body.email },
    include: { profile: true },
  });
  if (!user || !(await argon2.verify(user.passwordHash, req.body.password)))
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.status !== 'ACTIVE')
    throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is unavailable.');
  const tokens = await issueSession(user, req.header('user-agent'));
  res.cookie('unimate_refresh', tokens.refreshToken, { ...cookie, expires: tokens.expiresAt });
  ok(res, {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      profile: user.profile,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    accessToken: tokens.accessToken,
  });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.unimate_refresh as string | undefined;
  if (!token) throw new AppError(401, 'REFRESH_REQUIRED', 'Refresh token required.');
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as {
      sub: string;
      sid: string;
      type: string;
    };
    const session = await prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!session || session.refreshTokenHash !== hash(token) || session.user.status !== 'ACTIVE')
      throw new Error('invalid session');
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const tokens = await issueSession(session.user, req.header('user-agent'));
    res.cookie('unimate_refresh', tokens.refreshToken, { ...cookie, expires: tokens.expiresAt });
    ok(res, { accessToken: tokens.accessToken });
  } catch {
    res.clearCookie('unimate_refresh', cookie);
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please log in again.');
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.unimate_refresh as string | undefined;
  if (token)
    await prisma.authSession.updateMany({
      where: { refreshTokenHash: hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  res.clearCookie('unimate_refresh', cookie);
  ok(res, { loggedOut: true });
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email ?? '')
    .trim()
    .toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  let developmentToken: string | undefined;
  if (user?.status === 'ACTIVE') {
    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    if (env.NODE_ENV === 'development') developmentToken = token;
    // A production email adapter sends the raw token; only its hash is persisted.
  }
  ok(res, { accepted: true, ...(developmentToken ? { developmentToken } : {}) });
});

router.post('/reset-password', async (req, res) => {
  const token = String(req.body.token ?? '');
  const password = String(req.body.password ?? '');
  if (password.length < 8 || password.length > 128)
    throw new AppError(400, 'INVALID_PASSWORD', 'Password must contain 8 to 128 characters.');
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash: hash(token), usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!record)
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'The reset link is invalid or expired.');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await argon2.hash(password) },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.authSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  ok(res, { reset: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findFirst({
    where: { id: req.user!.id, deletedAt: null },
    select: { id: true, email: true, role: true, onboardingCompletedAt: true, profile: true },
  });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  ok(res, user);
});

export { router as authRouter };
