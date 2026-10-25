import type { StoredTrainArrival } from "../subway.document";
import { SUBWAY_STATIONS } from "../subway.constants";
import type { LocalizedName, PlatformDirection, SubwayRegistry, SubwayStation } from "../subway.types";

export function findSubwayStation(slug: string, registry: SubwayRegistry): SubwayStation | null {
  return registry.stations.find((station) => station.id === slug) ?? null;
}

// WHY: a served platform named as a neighbor stop takes its station's name, which the code holds even when the stored
// topology leaves that platform out; the topology gives such a platform no neighbor entry.
export function findPlatformName(platformId: string, registry: SubwayRegistry): LocalizedName | null {
  const servedAt = SUBWAY_STATIONS.find((station) => station.platforms.some((platform) => platform.id === platformId));
  return registry.neighbors[platformId]?.name ?? servedAt?.name ?? null;
}

// SEE: docs/decisions/0022-journey-and-call-spec.md ("D2. The call"): a platform the train's row passes is no stop.
export function toCallStopsAway(direction: PlatformDirection, platformId: string, train: Pick<StoredTrainArrival, "position" | "passedPlatformIds">): number | null {
  const { position } = train;
  const passed = new Set(train.passedPlatformIds ?? []);
  if (!position) return null;
  if (position.stationId === platformId) return position.state === "approaching" ? 1 : 0;
  const upstreamIndex = direction.upstreamPlatformIds.indexOf(position.stationId);
  if (upstreamIndex === -1) return null;
  const stopsBefore = direction.upstreamPlatformIds.slice(0, upstreamIndex).filter((id) => !passed.has(id)).length;
  return stopsBefore + (position.state === "approaching" && !passed.has(position.stationId) ? 1 : 0) + 1;
}

export function toStopsAway(direction: PlatformDirection, platformId: string, position: StoredTrainArrival["position"]): number | null {
  if (!position) return null;
  if (position.stationId === platformId) return 0;
  const upstreamIndex = direction.upstreamPlatformIds.indexOf(position.stationId);
  return upstreamIndex === -1 ? null : upstreamIndex + 1;
}
