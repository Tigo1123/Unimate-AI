import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './infrastructure/database/prisma.js';
import { safeAIStartupLines } from '@unimate/ai';
import { safeStorageStartupLine } from '@unimate/storage';
import {
  sourceProcessing,
  sourceProcessingStartupLine,
} from './infrastructure/source-processing/source-processing.runner.js';

await sourceProcessing.start();
const server = app.listen(env.PORT, () => {
  console.log(`UniMate API listening on http://localhost:${env.PORT}`);
  console.log(safeStorageStartupLine(env));
  console.log(sourceProcessingStartupLine());
  if (env.NODE_ENV === 'development') {
    for (const line of safeAIStartupLines(env)) console.log(line);
  }
});

async function shutdown() {
  server.close();
  await sourceProcessing.stop();
  await prisma.$disconnect();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
