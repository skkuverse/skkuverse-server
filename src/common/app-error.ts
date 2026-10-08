/**
 * AppError — controllers throw this to answer with an error.
 * HttpExceptionFilter renders it as { error: { code, message } } with httpStatus,
 * so controllers never touch res to send the error envelope.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
