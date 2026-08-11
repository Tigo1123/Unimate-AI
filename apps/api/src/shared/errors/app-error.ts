export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (name: string) =>
  new AppError(404, `${name.toUpperCase()}_NOT_FOUND`, `${name} not found.`);
