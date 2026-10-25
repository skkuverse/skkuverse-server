import type { SupportedLang } from "../../infra/types";
import type { StopCall } from "../../shared/call.types";
import { toCall } from "../../shared/call.util";
import { toKstInstant } from "../../shared/kst-date.util";
import type { LatLng } from "../../shared/lat-lng.types";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import { toSubwayLine } from "../subway.rules";
import type { PlatformDirection, SubwayDirection, SubwayPlatform, SubwayRegistry, SubwayStation } from "../subway.types";
import { CALL_BASIS_BY_SOURCE } from "./subway-arrivals.constants";
import { findPlatformName, toCallStatus, toCallStopsAway } from "./subway-arrivals.rules";
import type { SubwayStationArrivals } from "./subway-arrivals.wire";

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];

type WireLine = SubwayStationArrivals["lines"][number];
type WireDirection = WireLine["directions"][number];
type WireTrain = WireDirection["trains"][number];

// WHY: a scheduled train's time is the timetable's at this platform; one stored before the pair has only arrivalAt for it.
function toScheduledArrivalAt(train: StoredTrainArrival, basis: StopCall["basis"]): Date | null {
  if (train.scheduledArrivalAt !== undefined) return train.scheduledArrivalAt;
  return basis === "timetable" ? train.arrivalAt : null;
}

function toWireTrain(train: StoredTrainArrival, { platform, direction, serviceDate }: { platform: SubwayPlatform; direction: PlatformDirection; serviceDate: string }): WireTrain {
  const basis = CALL_BASIS_BY_SOURCE[train.source];
  const stopCall: StopCall = {
    status: toCallStatus(direction, platform.id, train),
    expectedArrivalAt: basis === "timetable" ? null : train.arrivalAt,
    expectedDepartureAt: null,
    scheduledArrivalAt: toScheduledArrivalAt(train, basis),
    scheduledDepartureAt: train.scheduledDepartureAt ?? null,
    basis,
    stopsAway: toCallStopsAway(direction, platform.id, train),
    runId: `${platform.line}/${serviceDate}/${train.trainNo}`,
    vehicleId: null,
    headsign: train.destination,
    isFirstRun: train.isFirstTrain,
    isLastRun: train.isLastRun ?? null,
    isExpress: train.express,
    providerText: null,
  };
  return { ...toCall(stopCall), trainNo: train.trainNo };
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
    generatedAt: toKstInstant(doc.generatedAt.getTime()),
    directions: DIRECTIONS.map((direction) => {
      const platformDirection = platform.directions[direction];
      return {
        direction,
        name: platformDirection.name[lang],
        previousStation: toNeighborStation(platformDirection.upstreamPlatformIds[0], lang, registry),
        nextStation: toNeighborStation(platformDirection.nextPlatformId, lang, registry),
        trains: doc.directions[direction].map((train) => toWireTrain(train, { platform, direction: platformDirection, serviceDate: doc.serviceDate })),
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
