import { describe, expect, it, vi } from 'vitest';
import { requireAdmin } from './admin.js';

describe('requireAdmin', () => {
  it('rejects an authenticated student from the usage dashboard', () => {
    const next = vi.fn();
    expect(() =>
      requireAdmin({ user: { id: 'user-1', role: 'STUDENT' } } as never, {} as never, next),
    ).toThrow(expect.objectContaining({ status: 403, code: 'ADMIN_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an administrator', () => {
    const next = vi.fn();
    requireAdmin({ user: { id: 'admin-1', role: 'ADMIN' } } as never, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
