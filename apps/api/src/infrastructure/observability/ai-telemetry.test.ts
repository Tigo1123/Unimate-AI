import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendAiTelemetryRecord, parseAiTelemetryLine } from './ai-telemetry.js';

const testDirectory = path.join('/tmp', `unimate-ai-telemetry-${process.pid}`);
const testFile = path.join(testDirectory, 'nested', 'telemetry.jsonl');

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(testDirectory, { recursive: true, force: true });
});

describe('telemetry JSONL parsing', () => {
  it('rejects malformed and incomplete telemetry without throwing', () => {
    expect(parseAiTelemetryLine('{not json')).toBeNull();
    expect(parseAiTelemetryLine(JSON.stringify({ timestamp: 'bad', event: 'x' }))).toBeNull();
  });
});

describe('AI telemetry', () => {
  it('creates its directory and appends parseable JSON lines', () => {
    appendAiTelemetryRecord(testFile, 'warn', 'gemini.retry', {
      status: 429,
      retryAfterMs: 59_000,
    });
    appendAiTelemetryRecord(testFile, 'info', 'rag.request.completed', { totalMs: 1234 });

    const records = readFileSync(testFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      level: 'warn',
      event: 'gemini.retry',
      status: 429,
      retryAfterMs: 59_000,
    });
    expect(records[1]).toMatchObject({ event: 'rag.request.completed', totalMs: 1234 });
    expect(records[0].timestamp).toEqual(expect.any(String));
  });
});
