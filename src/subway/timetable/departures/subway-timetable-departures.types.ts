import type { SupportedLang } from "../../../infra/types";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { Place } from "../../../shared/place.wire";
import type { SubwayRegistry } from "../../subway.types";
import type { ScheduledStop, ScheduledTrain } from "../subway-timetable.types";

/** WHY: a train that serves a ride, its stop at the board platform and its stop at the alight one, null when no table places it there. */
export interface LegTrain {
  train: ScheduledTrain;
  boardStop: ScheduledStop;
  alightStop: ScheduledStop | null;
}

/** WHY: a dataset's ride on a subway line, as the push checks it against the stored tables. */
export interface SubwayRide {
  lineId: string;
  boardPlatformId: string;
  alightPlatformId: string;
}

/** WHY: what places a stop a ride passes: the topology's registry, a served station's stored coords, the request language. */
export interface RideStopCatalog {
  registry: SubwayRegistry;
  coordsOf: (stationId: string) => LatLng | null;
  lang: SupportedLang;
}

/** WHY: the stops a train passes on the ride, from its own row; null when the door cannot list them all. */
export type RideStopsOf = (train: ScheduledTrain) => Place[] | null;
