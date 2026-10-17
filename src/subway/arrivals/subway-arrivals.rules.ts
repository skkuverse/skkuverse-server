import type { StoredTrainArrival } from "../subway.document";
import type { StationDirection } from "../subway.types";
import { MAX_STATE_AGE_MS } from "./subway-arrivals.constants";

export function isFreshState(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= MAX_STATE_AGE_MS;
}

export function toStopsAway(direction: StationDirection, platformId: string, position: StoredTrainArrival["position"]): number | null {
  if (!position) return null;
  if (position.stationId === platformId) return 0;
  const upstreamIndex = direction.upstreamPlatformIds.indexOf(position.stationId);
  return upstreamIndex === -1 ? null : upstreamIndex + 1;
}
