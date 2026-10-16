import { SUBWAY_STATIONS } from "./subway.constants";
import type { SubwayStation } from "./subway.types";

export function findSubwayStation(id: string): SubwayStation | null {
  return SUBWAY_STATIONS.find((station) => station.id === id) ?? null;
}
