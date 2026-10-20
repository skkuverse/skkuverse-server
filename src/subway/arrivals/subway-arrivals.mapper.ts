import type { SupportedLang } from "../../infra/types";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import { toSubwayLine } from "../subway.rules";
import type { PlatformDirection, SubwayDirection, SubwayPlatform, SubwayRegistry, SubwayStation } from "../subway.types";
import { findPlatformName, toStopsAway } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];

type WireLine = SubwayStationArrivals["lines"][number];
type WireDirection = WireLine["directions"][number];
type WireTrain = WireDirection["trains"][number];

function toWireTrain(train: StoredTrainArrival, direction: PlatformDirection, platformId: string): WireTrain {
  const { trainNo, destination, express, arrivalAt, position, source } = train;
  const stopsAway = toStopsAway(direction, platformId, position);
  return { trainNo, destination, express, arrivalAt: arrivalAt.toISOString(), stopsAway, source };
}

function toNeighborStation(id: string | undefined, lang: SupportedLang, registry: SubwayRegistry): WireDirection["nextStation"] {
  if (id === undefined) return null;
  const name = findPlatformName(id, registry);
  if (!name) throw new Error(`subway: no neighbor name for ${id}`);
  return { id, name: name[lang] };
}

function toWireLine({ platform, doc }: { platform: SubwayPlatform; doc: SubwayArrivalsDoc }, lang: SupportedLang, registry: SubwayRegistry): WireLine {
  const { code, name, color, marker } = toSubwayLine(platform.line);
  return {
    line: { code, name: name[lang], color, marker: { text: marker.text[lang], color: marker.color } },
    platformId: platform.id,
    generatedAt: doc.generatedAt.toISOString(),
    directions: DIRECTIONS.map((direction) => {
      const platformDirection = platform.directions[direction];
      return {
        direction,
        name: platformDirection.name[lang],
        previousStation: toNeighborStation(platformDirection.upstreamPlatformIds[0], lang, registry),
        nextStation: toNeighborStation(platformDirection.nextPlatformId, lang, registry),
        trains: doc.directions[direction].map((train) => toWireTrain(train, platformDirection, platform.id)),
      };
    }),
  };
}

export function toSubwayStationArrivals(
  station: SubwayStation,
  platformDocs: ReadonlyArray<{ platform: SubwayPlatform; doc: SubwayArrivalsDoc }>,
  { lang, registry }: { lang: SupportedLang; registry: SubwayRegistry },
): SubwayStationArrivals {
  return { station: { id: station.id, name: station.name[lang] }, lines: platformDocs.map((platformDoc) => toWireLine(platformDoc, lang, registry)) };
}
