import { startAiCooldown } from '../app/ai-cooldown';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
let accessToken: string | null = sessionStorage.getItem('accessToken');
const SESSION_HINT_KEY = 'unimateSession';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly retryAfterSeconds?: number,
    public readonly rateLimitScope?: 'MINUTE' | 'DAY',
  ) {
    super(message);
  }
}

export const hasAccessToken = () => Boolean(accessToken);
export const hasSessionHint = () => localStorage.getItem(SESSION_HINT_KEY) === 'active';

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (token) {
    sessionStorage.setItem('accessToken', token);
    localStorage.setItem(SESSION_HINT_KEY, 'active');
  } else {
    sessionStorage.removeItem('accessToken');
    localStorage.removeItem(SESSION_HINT_KEY);
  }
};

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && retry && path !== '/auth/refresh') {
    const refresh = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (refresh.ok) {
      const body = await refresh.json();
      setAccessToken(body.data.accessToken);
      return request(path, init, false);
    }
    setAccessToken(null);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new ApiError(
      body?.error?.message ?? 'Request failed',
      response.status,
      body?.error?.code,
      body?.error?.requestId,
      body?.error?.retryAfterSeconds,
      body?.error?.rateLimitScope,
    );
    if (error.code === 'AI_RATE_LIMITED' && error.retryAfterSeconds)
      startAiCooldown(error.retryAfterSeconds, error.rateLimitScope);
    throw error;
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function restoreAccessToken() {
  const result = await request<{ accessToken: string }>('/auth/refresh', { method: 'POST' }, false);
  setAccessToken(result.accessToken);
}
