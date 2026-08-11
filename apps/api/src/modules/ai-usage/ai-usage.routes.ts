import { Router } from 'express';
import { z } from 'zod';
import { aiProvider } from '../../infrastructure/ai/provider.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { requireAdmin } from '../../middleware/admin.js';
import { ok } from '../../shared/http/respond.js';
import { AiUsageService } from './ai-usage.service.js';

const router = Router();
const service = new AiUsageService(prisma, aiProvider.name, aiProvider.chatModel);
const rangeSchema = z.enum(['today', '7d', '30d']).default('today');

router.get('/ai-usage', requireAdmin, async (req, res) => {
  const range = rangeSchema.parse(req.query.range);
  ok(res, await service.dashboard(range));
});

export { router as aiUsageRouter };
