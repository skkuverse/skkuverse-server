export class NoticesListCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticesListCursorError";
  }
}
