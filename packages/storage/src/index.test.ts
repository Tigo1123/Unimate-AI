import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageService, loadStorageEnvironment, safeStorageStartupLine } from './index.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('storage providers', () => {
  it('keeps local put/get/open/delete behavior intact', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'unimate-storage-'));
    temporaryDirectories.push(directory);
    const storage = new LocalStorageService(directory);
    await storage.put('user/course/file.txt', Buffer.from('lecture'));
    await expect(storage.get('user/course/file.txt')).resolves.toEqual(Buffer.from('lecture'));
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.open('user/course/file.txt'))
      chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('lecture');
    expect(await readFile(path.join(directory, 'user/course/file.txt'), 'utf8')).toBe('lecture');
    await storage.delete('user/course/file.txt');
    await expect(storage.get('user/course/file.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires complete R2 configuration and masks credentials in startup output', () => {
    const environment = loadStorageEnvironment({
      STORAGE_PROVIDER: 'r2',
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'access-secret',
      R2_SECRET_ACCESS_KEY: 'secret-secret',
      R2_BUCKET_NAME: 'unimate',
      R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    });
    const line = safeStorageStartupLine(environment);
    expect(line).toBe(
      'Storage provider: r2 (bucket=unimate, endpoint=account.r2.cloudflarestorage.com)',
    );
    expect(line).not.toContain('access-secret');
    expect(line).not.toContain('secret-secret');
  });
});
