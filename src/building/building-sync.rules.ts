/**
 * Below this many listed buildings, SKKU answered without usable data (an
 * empty body, a renamed field): nothing is written and the run fails.
 */
export const MIN_BUILDINGS_TO_TRUST = 50;

/** Below this many listed spaces, the stale-space delete is skipped. */
export const MIN_SPACES_FOR_STALE_DELETE = 5000;

/** buildInfo requests in flight at once. */
export const BUILD_INFO_CONCURRENCY = 5;

/**
 * A listed building is (re-)enriched when it is new, when SKKU changed it, or
 * when its enrichment predates the current ENRICH_VERSION.
 */
export function needsEnrichment(
  knownUpdatedAt: string | null | undefined,
  listedUpdatedAt: string | null,
  enrichedAtOldVersion: boolean,
): boolean {
  return (
    knownUpdatedAt === undefined || knownUpdatedAt !== listedUpdatedAt || enrichedAtOldVersion
  );
}

export interface PhaseFailure {
  phase: string;
  err: unknown;
}

/** The run's one rejection: the failed phases by name, their errors in `errors`. */
export function toSyncError(failures: readonly PhaseFailure[]): AggregateError {
  return new AggregateError(
    failures.map((f) => f.err),
    `Building sync failed in ${failures.map((f) => f.phase).join(" and ")}`,
  );
}
