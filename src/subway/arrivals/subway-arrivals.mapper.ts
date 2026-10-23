import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
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

// WHY: a stop with no name is served as null, as a terminus is, not as a 500: a topology pushed ahead of a deploy may
// drop the entry that named it (SubwayTopologyService logs it once per revision).
function toNeighborStation(id: string | undefined, lang: SupportedLang, registry: SubwayRegistry): WireDirection["nextStation"] {
  const name = id === undefined ? null : findPlatformName(id, registry);
  return id === undefined || name === null ? null : { id, name: name[lang] };
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
  { lang, registry, coords }: { lang: SupportedLang; registry: SubwayRegistry; coords: LatLng | null },
): SubwayStationArrivals {
  return { station: { id: station.id, name: station.name[lang], coords }, lines: platformDocs.map((platformDoc) => toWireLine(platformDoc, lang, registry)) };
}
