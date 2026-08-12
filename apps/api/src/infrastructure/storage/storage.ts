import { createStorage, createStorageForProvider } from '@unimate/storage';
import { env } from '../../config/env.js';

export const storage = createStorage(env);
const providers = new Map<string, ReturnType<typeof createStorage>>([[storage.provider, storage]]);

export function storageForProvider(provider: string) {
  if (provider !== 'local' && provider !== 'r2')
    throw new Error(`Unsupported storage provider: ${provider}`);
  const existing = providers.get(provider);
  if (existing) return existing;
  const created = createStorageForProvider(provider, env);
  providers.set(provider, created);
  return created;
}
