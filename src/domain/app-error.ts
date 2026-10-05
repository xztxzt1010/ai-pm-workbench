export type AppErrorCode =
  | "validation"
  | "not_found"
  | "conflict"
  | "storage"
  | "permission"
  | "external_service"
  | "unexpected"

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly cause?: unknown

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = "AppError"
    this.code = code
    this.cause = cause
  }
}

export function normalizeAppError(
  error: unknown,
  fallbackCode: AppErrorCode,
  safeMessage: string,
) {
  return error instanceof AppError ? error : new AppError(fallbackCode, safeMessage, error)
}
