import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';

export interface StorageService {
  put(key: string, data: Buffer): Promise<void>;
  open(key: string): Readable;
  delete(key: string): Promise<void>;
  absolutePath(key: string): string;
}

class LocalStorageService implements StorageService {
  private readonly repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../..',
  );
  private readonly root = path.resolve(this.repositoryRoot, env.LOCAL_STORAGE_PATH);
  private resolve(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new Error('Unsafe storage key');
    return resolved;
  }
  async put(key: string, data: Buffer) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
  }
  open(key: string) {
    return createReadStream(this.resolve(key));
  }
  async delete(key: string) {
    await unlink(this.resolve(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  absolutePath(key: string) {
    return this.resolve(key);
  }
}

export const storage: StorageService = new LocalStorageService();
