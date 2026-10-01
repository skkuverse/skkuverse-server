/**
 * An upstream answered, but not with usable data: a TOPIS error code, or a
 * body of the wrong shape. Thrown so the poller registry counts the tick as
 * failed (scheduling/poller-registry.service.ts); the fields land in the log
 * line through the error serializer.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly upstream: string,
    readonly headerCd?: string,
    readonly headerMsg?: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
