/** An error that is safe to show the user. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (message = "Sign in to continue") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tooMany = (code: string, message: string) => new AppError(429, code, message);
export const unprocessable = (code: string, message: string) => new AppError(422, code, message);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);

/** A Postgres unique-constraint violation (23505), as drizzle passes it on from either driver. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
