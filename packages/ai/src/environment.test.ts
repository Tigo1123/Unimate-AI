import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAIEnvironment, loadRootEnvironment } from './environment.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('root environment loading', () => {
  it('uses platform-injected process variables without requiring an env file', () => {
    const platform = {
      AI_PROVIDER: 'mock',
      AI_MODEL: 'render-model',
      EMBEDDING_MODEL: 'local-hash-v1',
      EMBEDDING_DIMENSIONS: '1536',
    };
    expect(loadRootEnvironment(platform, '/missing/render/.env')).toEqual({});
    expect(
      loadAIEnvironment(loadRootEnvironment(platform, '/missing/render/.env'), platform),
    ).toMatchObject({
      AI_PROVIDER: 'mock',
      AI_MODEL: 'render-model',
      EMBEDDING_MODEL: 'local-hash-v1',
    });
  });

  it('falls back to a local env file when process variables are absent', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'unimate-env-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, '.env');
    await writeFile(
      file,
      'AI_PROVIDER=mock\nAI_MODEL=local-model\nEMBEDDING_MODEL=local-hash-v1\n',
    );
    expect(loadRootEnvironment({}, file)).toMatchObject({
      AI_PROVIDER: 'mock',
      AI_MODEL: 'local-model',
      EMBEDDING_MODEL: 'local-hash-v1',
    });
  });

  it('throws only when configuration is absent from both process and file', () => {
    expect(() => loadRootEnvironment({}, '/missing/local/.env')).toThrow(
      'required environment variables are not present in process.env',
    );
  });

  it('throws when an existing fallback file also lacks the shared required variables', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'unimate-env-incomplete-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, '.env');
    await writeFile(file, 'AI_PROVIDER=mock\n');
    expect(() => loadRootEnvironment({}, file)).toThrow(
      'required environment variables are not present in process.env',
    );
  });
});
