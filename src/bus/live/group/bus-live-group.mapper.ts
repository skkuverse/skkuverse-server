import type { StationDirection } from "../../config/bus-config.types";
import type { LiveGroup } from "../bus-live.wire";

/** WHY: a live call heads where its station's direction does, as /bus/config labels it there (ADR 0019, D16; ADR 0022, D2). */
export function withHeadsigns(group: LiveGroup, directions: ReadonlyArray<StationDirection | null>): LiveGroup {
  return {
    ...group,
    stations: group.stations.map((station) => {
      const headsign = directions[station.stationIndex]?.label ?? null;
      return { ...station, arrivals: station.arrivals.map((arrival) => ({ ...arrival, headsign })) };
    }),
  };
}
