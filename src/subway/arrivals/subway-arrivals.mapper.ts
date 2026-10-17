import type { SupportedLang } from "../../infra/types";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { StationDirection, SubwayDirection, SubwayStation } from "../subway.types";
import { NEIGHBOR_NAME_BY_STATION_ID } from "./subway-arrivals.constants";
import { toStopsAway } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];

type WireDirection = SubwayStationArrivals["directions"][number];
type WireTrain = WireDirection["trains"][number];

function toWireTrain(train: StoredTrainArrival, direction: StationDirection, stationId: string): WireTrain {
  const { trainNo, destination, express, arrivalAt, position, source } = train;
  const stopsAway = toStopsAway(direction, stationId, position);
  return { trainNo, destination, express, arrivalAt: arrivalAt.toISOString(), stopsAway, source };
}

function toNeighborStation(id: string | undefined, lang: SupportedLang): WireDirection["nextStation"] {
  if (id === undefined) return null;
  const name = NEIGHBOR_NAME_BY_STATION_ID[id];
  if (!name) throw new Error(`subway: no neighbor name for ${id}`);
  return { id, name: name[lang] };
}

export function toSubwayStationArrivals(station: SubwayStation, doc: SubwayArrivalsDoc, lang: SupportedLang): SubwayStationArrivals {
  const { id, operatorCode, lineCode, stationCode } = station;
  return {
    station: { id, operatorCode, lineCode, stationCode, name: station.name[lang] },
    generatedAt: doc.generatedAt.toISOString(),
    directions: DIRECTIONS.map((direction) => {
      const stationDirection = station.directions[direction];
      return {
        direction,
        name: stationDirection.name[lang],
        previousStation: toNeighborStation(stationDirection.upstreamStationIds[0], lang),
        nextStation: toNeighborStation(stationDirection.nextStationId, lang),
        trains: doc.directions[direction].map((train) => toWireTrain(train, stationDirection, id)),
      };
    }),
  };
}
