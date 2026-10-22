import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";

// WHY: half the arrivals route's 120 s staleness limit (MAX_STATE_AGE_MS), so a platform whose trains stay
// unchanged is rewritten before it could be served as stale while the tracker runs.
const MAX_UNCHANGED_WRITE_AGE_MS = 60_000;

function toTrainKey(train: StoredTrainArrival): string {
  const { trainNo, destination, express, arrivalAt, source, position } = train;
  return JSON.stringify([trainNo, destination, express, arrivalAt.getTime(), source, position?.stationId ?? null, position?.state ?? null]);
}

function isSameTrainList(written: readonly StoredTrainArrival[], next: readonly StoredTrainArrival[]): boolean {
  return JSON.stringify(written.map(toTrainKey)) === JSON.stringify(next.map(toTrainKey));
}

export function isArrivalsWriteDue(lastWritten: SubwayArrivalsDoc | undefined, next: SubwayArrivalsDoc): boolean {
  if (!lastWritten) return true;
  if (next.generatedAt.getTime() - lastWritten.generatedAt.getTime() >= MAX_UNCHANGED_WRITE_AGE_MS) return true;
  if (lastWritten.serviceDate !== next.serviceDate) return true;
  return !isSameTrainList(lastWritten.directions.up, next.directions.up) || !isSameTrainList(lastWritten.directions.down, next.directions.down);
}
