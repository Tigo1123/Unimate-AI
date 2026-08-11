import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Prisma } from '@prisma/client';
import {
  aiTelemetryLogPath,
  parseAiTelemetryLine,
  persistAiTelemetryRecord,
} from '../infrastructure/observability/ai-telemetry.js';
import { prisma } from '../infrastructure/database/prisma.js';

const filePath = process.argv[2] || aiTelemetryLogPath;
let imported = 0;
let skipped = 0;
let malformed = 0;

const lines = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const record = parseAiTelemetryLine(line);
  if (!record) {
    malformed++;
    continue;
  }
  const fingerprint = createHash('sha256').update(line).digest('hex');
  try {
    await persistAiTelemetryRecord(record, fingerprint);
    imported++;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') skipped++;
    else throw error;
  }
}

console.log({ filePath, imported, skipped, malformed });
await prisma.$disconnect();
