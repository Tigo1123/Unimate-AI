import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../shared/errors/app-error.js';

type AccessPayload = { sub: string; role: 'STUDENT' | 'ADMIN'; type: 'access' };

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer '))
    throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required.');
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AccessPayload;
    if (payload.type !== 'access') throw new Error('wrong token type');
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.');
  }
};
