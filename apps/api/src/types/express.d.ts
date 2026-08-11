declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: 'STUDENT' | 'ADMIN' };
      requestId?: string;
    }
  }
}
export {};
