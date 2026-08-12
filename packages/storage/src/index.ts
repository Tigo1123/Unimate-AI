import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const storageEnvironmentSchema = z
  .object({
    STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
    LOCAL_STORAGE_PATH: z.string().default('./uploads'),
    R2_ACCOUNT_ID: z.string().trim().optional(),
    R2_ACCESS_KEY_ID: z.string().trim().optional(),
    R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
    R2_BUCKET_NAME: z.string().trim().optional(),
    R2_ENDPOINT: z.string().url().optional(),
  })
  .superRefine((environment, context) => {
    if (environment.STORAGE_PROVIDER !== 'r2') return;
    for (const key of [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET_NAME',
      'R2_ENDPOINT',
    ] as const) {
      if (!environment[key])
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when STORAGE_PROVIDER=r2`,
        });
    }
  });

export type StorageEnvironment = z.infer<typeof storageEnvironmentSchema>;

export function loadStorageEnvironment(environment: NodeJS.ProcessEnv | Record<string, unknown>) {
  return storageEnvironmentSchema.parse(environment);
}

export interface StorageService {
  readonly provider: 'local' | 'r2';
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  open(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

function safeKey(key: string) {
  if (!key || key.startsWith('/') || key.includes('\\') || key.split('/').includes('..'))
    throw new Error('Unsafe storage key');
  return key;
}

export class LocalStorageService implements StorageService {
  readonly provider = 'local' as const;
  private readonly root: string;

  constructor(localStoragePath = './uploads') {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    this.root = path.resolve(repositoryRoot, localStoragePath);
  }

  private resolve(key: string) {
    const resolved = path.resolve(this.root, safeKey(key));
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new Error('Unsafe storage key');
    return resolved;
  }

  async put(key: string, data: Buffer) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async open(key: string) {
    return createReadStream(this.resolve(key));
  }

  async delete(key: string) {
    await unlink(this.resolve(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export class R2StorageService implements StorageService {
  readonly provider = 'r2' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(environment: StorageEnvironment) {
    if (
      !environment.R2_ENDPOINT ||
      !environment.R2_ACCESS_KEY_ID ||
      !environment.R2_SECRET_ACCESS_KEY ||
      !environment.R2_BUCKET_NAME
    )
      throw new Error('R2 storage configuration is incomplete');
    this.bucket = environment.R2_BUCKET_NAME;
    this.client = new S3Client({
      region: 'auto',
      endpoint: environment.R2_ENDPOINT,
      credentials: {
        accessKeyId: environment.R2_ACCESS_KEY_ID,
        secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(key: string, data: Buffer, contentType?: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    if (!response.Body) throw new Error(`R2 object ${key} returned an empty body`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async open(key: string) {
    return Readable.from(await this.get(key));
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
}

export function createStorage(environment: StorageEnvironment): StorageService {
  return createStorageForProvider(environment.STORAGE_PROVIDER, environment);
}

export function createStorageForProvider(
  provider: 'local' | 'r2',
  environment: StorageEnvironment,
): StorageService {
  return provider === 'r2'
    ? new R2StorageService(environment)
    : new LocalStorageService(environment.LOCAL_STORAGE_PATH);
}

export function safeStorageStartupLine(environment: StorageEnvironment) {
  if (environment.STORAGE_PROVIDER === 'local')
    return `Storage provider: local (${environment.LOCAL_STORAGE_PATH})`;
  const endpointHost = environment.R2_ENDPOINT
    ? new URL(environment.R2_ENDPOINT).host
    : 'not configured';
  return `Storage provider: r2 (bucket=${environment.R2_BUCKET_NAME ?? 'not configured'}, endpoint=${endpointHost})`;
}
