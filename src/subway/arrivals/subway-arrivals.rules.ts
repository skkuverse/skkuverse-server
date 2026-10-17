import { SUBWAY_REGISTRY } from "../subway.config";
import type { StoredTrainArrival } from "../subway.document";
import type { LocalizedName, PlatformDirection, SubwayRegistry, SubwayStation } from "../subway.types";
import { MAX_STATE_AGE_MS } from "./subway-arrivals.constants";

export function findSubwayStation(slug: string, registry: SubwayRegistry = SUBWAY_REGISTRY): SubwayStation | null {
  return registry.stations.find((station) => station.id === slug) ?? null;
}

// WHY: a served platform named as a neighbor stop takes its station's name, which the registry gives no neighbor entry.
export function findPlatformName(platformId: string, registry: SubwayRegistry = SUBWAY_REGISTRY): LocalizedName | null {
  const servedAt = registry.stations.find((station) => station.platforms.some((platform) => platform.id === platformId));
  return registry.neighbors[platformId]?.name ?? servedAt?.name ?? null;
}

export function isFreshState(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= MAX_STATE_AGE_MS;
}

export function toStopsAway(direction: PlatformDirection, platformId: string, position: StoredTrainArrival["position"]): number | null {
  if (!position) return null;
  if (position.stationId === platformId) return 0;
  const upstreamIndex = direction.upstreamPlatformIds.indexOf(position.stationId);
  return upstreamIndex === -1 ? null : upstreamIndex + 1;
}
