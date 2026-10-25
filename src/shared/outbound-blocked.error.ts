export class OutboundBlockedError extends Error {
  readonly code = "EOUTBOUNDBLOCKED";

  constructor(message: string) {
    super(message);
    this.name = "OutboundBlockedError";
  }
}
