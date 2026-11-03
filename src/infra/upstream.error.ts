import type { UpstreamFailure } from "./types";

// WHY: thrown when an upstream fails the call or answers without usable data (an error code, a body of the wrong
// shape), so the poller registry counts the tick as failed; the error serializer puts the fields in the log line.
export class UpstreamError extends Error {
  readonly headerCd?: string;
  readonly headerMsg?: string;
  readonly failure?: UpstreamFailure;

  constructor(
    message: string,
    readonly upstream: string,
    answered: { headerCd?: string; headerMsg?: string; failure?: UpstreamFailure } = {},
  ) {
    super(message);
    this.name = "UpstreamError";
    this.headerCd = answered.headerCd;
    this.headerMsg = answered.headerMsg;
    this.failure = answered.failure;
  }
}
