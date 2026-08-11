import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { nextPacificMidnight, rootEnvPath } from '@unimate/ai';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma.js';

export type AiTelemetryLevel = 'info' | 'warn' | 'error';

const defaultLogPath = path.join(path.dirname(rootEnvPath), 'logs', 'ai-telemetry.jsonl');

function safeMetadata(metadata: Record<string, unknown>) {
  try {
    return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
  } catch {
    return { serializationError: true };
  }
}

export type AiTelemetryRecord = Record<string, unknown> & {
  timestamp: string;
  level: AiTelemetryLevel;
  event: string;
  pid?: number;
};

export function parseAiTelemetryLine(line: string): AiTelemetryRecord | null {
  try {
    const record = JSON.parse(line) as Partial<AiTelemetryRecord>;
    if (
      typeof record.timestamp !== 'string' ||
      Number.isNaN(new Date(record.timestamp).getTime()) ||
      (record.level !== 'info' && record.level !== 'warn' && record.level !== 'error') ||
      typeof record.event !== 'string' ||
      !record.event
    )
      return null;
    return record as AiTelemetryRecord;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function integer(value: unknown) {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.round(number);
}

function text(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

export async function persistAiTelemetryRecord(record: AiTelemetryRecord, fingerprint?: string) {
  const observedAt = new Date(record.timestamp);
  if (Number.isNaN(observedAt.getTime())) throw new Error('Invalid telemetry timestamp.');
  const dimensions =
    record.quotaDimensions && typeof record.quotaDimensions === 'object'
      ? (record.quotaDimensions as Record<string, unknown>)
      : {};
  const provider =
    text(record.provider) ?? (record.event.includes('Gemini') ? 'gemini' : undefined);
  const model = text(record.model) ?? text(dimensions.model);
  const quotaId = text(record.quotaId);
  const rateLimitScope = text(record.rateLimitScope);
  return prisma.$transaction(async (transaction) => {
    const created = await transaction.aiTelemetryEvent.create({
      data: {
        observedAt,
        level: record.level,
        event: record.event,
        pid: integer(record.pid) ?? null,
        feature: text(record.feature) ?? null,
        provider: provider ?? null,
        model: model ?? null,
        outcome: text(record.outcome) ?? null,
        status: integer(record.status) ?? null,
        providerRequests: integer(record.geminiRequests) ?? null,
        estimatedInputTokens: integer(record.estimatedInputTokens) ?? null,
        promptTokens: integer(record.promptTokens) ?? null,
        outputTokens: integer(record.outputTokens) ?? null,
        thinkingTokens: integer(record.thinkingTokens) ?? null,
        batchCount: integer(record.batchCount) ?? null,
        synthesisRequestCount: integer(record.synthesisRequestCount) ?? null,
        cacheStatus: text(record.cacheStatus) ?? null,
        cacheHits: integer(record.cacheHits) ?? null,
        cacheMisses: integer(record.cacheMisses) ?? null,
        sharedBatches: integer(record.sharedBatches) ?? null,
        openAnswerCount: integer(record.openAnswerCount) ?? null,
        totalLatencyMs: integer(record.totalLatencyMs ?? record.totalMs) ?? null,
        metadata: record as Prisma.InputJsonValue,
        fingerprint: fingerprint ?? null,
      },
    });
    if (provider && model && quotaId && rateLimitScope) {
      const retryAfterMs = finiteNumber(record.retryAfterMs);
      const resetAt =
        rateLimitScope === 'DAY'
          ? nextPacificMidnight(observedAt)
          : retryAfterMs
            ? new Date(observedAt.getTime() + retryAfterMs)
            : undefined;
      await transaction.aiQuotaObservation.create({
        data: {
          provider,
          model,
          quotaId,
          quotaMetric: text(record.quotaMetric) ?? null,
          quotaValue: finiteNumber(record.quotaValue) ?? null,
          quotaDimensions: dimensions as Prisma.InputJsonValue,
          rateLimitScope,
          observedAt,
          resetAt: resetAt ?? null,
          eventId: created.id,
        },
      });
    }
    return created.id;
  });
}

export function appendAiTelemetryRecord(
  filePath: string,
  level: AiTelemetryLevel,
  event: string,
  metadata: Record<string, unknown> = {},
) {
  const record: AiTelemetryRecord = {
    timestamp: new Date().toISOString(),
    level,
    event,
    pid: process.pid,
    ...safeMetadata(metadata),
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o640 });
  return record;
}

export function writeAiTelemetry(
  level: AiTelemetryLevel,
  event: string,
  metadata: Record<string, unknown> = {},
) {
  const filePath = process.env.AI_TELEMETRY_LOG_PATH || defaultLogPath;
  try {
    const record = appendAiTelemetryRecord(filePath, level, event, metadata);
    void persistAiTelemetryRecord(record).catch((error) => {
      console.error('Unable to persist AI telemetry to PostgreSQL', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    // Observability must never turn a study request into a failure.
    console.error('Unable to persist AI telemetry', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const aiTelemetryLogPath = process.env.AI_TELEMETRY_LOG_PATH || defaultLogPath;
