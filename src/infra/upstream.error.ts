// WHY: thrown when an upstream answers without usable data (an error code, a body of the wrong shape), so the
// poller registry counts the tick as failed; the error serializer puts the fields in the log line.
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
