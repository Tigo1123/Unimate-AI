import type { RequestHandler } from 'express';
import { AppError } from '../shared/errors/app-error.js';

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN')
    throw new AppError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
  next();
};
