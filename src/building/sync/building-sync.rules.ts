/** Fewer listed buildings (78 exist) means SKKU answered without usable data: an empty body, a renamed field. */
export const MIN_BUILDINGS_TO_TRUST = 50;

/** About 7700 spaces exist; deleting against a shorter list would drop real rooms. */
export const MIN_SPACES_FOR_STALE_DELETE = 5000;

export const BUILD_INFO_CONCURRENCY = 5;

/** `knownUpdatedAt` is undefined for a building never seen before. */
export function needsEnrichment({
  knownUpdatedAt,
  listedUpdatedAt,
  isEnrichedAtOldVersion,
}: {
  knownUpdatedAt: string | null | undefined;
  listedUpdatedAt: string | null;
  isEnrichedAtOldVersion: boolean;
}): boolean {
  return knownUpdatedAt === undefined || knownUpdatedAt !== listedUpdatedAt || isEnrichedAtOldVersion;
}

export interface PhaseFailure {
  phase: string;
  err: unknown;
}

export function toSyncError(failures: readonly PhaseFailure[]): AggregateError {
  return new AggregateError(
    failures.map((f) => f.err),
    `Building sync failed in ${failures.map((f) => f.phase).join(" and ")}`,
  );
}
