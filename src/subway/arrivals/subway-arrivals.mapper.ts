import type { SupportedLang } from "../../infra/types";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import type { SubwayDirection, SubwayStation } from "../subway.types";
import { toRemainingSec } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];

type WireTrain = SubwayStationArrivals["directions"][number]["trains"][number];

function toWireTrain(train: StoredTrainArrival, generatedAt: Date): WireTrain {
  const { trainNo, destination, express, arrivalAt, position, source } = train;
  return {
    trainNo,
    destination,
    express,
    arrivalAt: arrivalAt.toISOString(),
    remainingSec: toRemainingSec(arrivalAt, generatedAt),
    position,
    source,
  };
}

export function toSubwayStationArrivals(station: SubwayStation, doc: SubwayArrivalsDoc, lang: SupportedLang): SubwayStationArrivals {
  const { id, operatorCode, lineCode, stationCode } = station;
  return {
    station: { id, operatorCode, lineCode, stationCode, name: station.name[lang] },
    generatedAt: doc.generatedAt.toISOString(),
    directions: DIRECTIONS.map((direction) => ({
      direction,
      name: station.directions[direction].name[lang],
      trains: doc.directions[direction].map((train) => toWireTrain(train, doc.generatedAt)),
    })),
  };
}
