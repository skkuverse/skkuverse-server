import type { UnavailableCause } from "./notices-overview.types";

// WHY: thrown out of the cached load, so the cache keeps nothing for an ai failure.
export class NoticesOverviewUnavailableError extends Error {
  constructor(readonly detail: UnavailableCause) {
    super(`overview unavailable: ${detail.cause}`);
    this.name = "NoticesOverviewUnavailableError";
  }
}
