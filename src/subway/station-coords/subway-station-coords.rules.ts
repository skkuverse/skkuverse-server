import type { StationCoordsIssue, SubwayStationCoordsData } from "./subway-station-coords.types";

export function toMissingStationIds({ stations }: SubwayStationCoordsData, stationIds: readonly string[]): string[] {
  return stationIds.filter((stationId) => !Object.hasOwn(stations, stationId));
}

export function toUnknownStationIds({ stations }: SubwayStationCoordsData, stationIds: readonly string[]): string[] {
  const served = new Set(stationIds);
  return Object.keys(stations).filter((stationId) => !served.has(stationId));
}

/** WHY: the stored coords must place exactly the stations the checked-out code serves. */
export function toStationCoordsIssues(coords: SubwayStationCoordsData, stationIds: readonly string[]): StationCoordsIssue[] {
  return [
    ...toMissingStationIds(coords, stationIds).map((stationId) => ({
      path: ["stations", stationId],
      message: `missing: the checked-out code serves "${stationId}", so it needs coords`,
    })),
    ...toUnknownStationIds(coords, stationIds).map((stationId) => ({ path: ["stations", stationId], message: `"${stationId}" is not a station the checked-out code serves` })),
  ];
}
