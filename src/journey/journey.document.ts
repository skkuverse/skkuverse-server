import type { SupportedLang } from "../infra/types";
import type { LatLng } from "../shared/lat-lng.types";
import type { JourneySourceId } from "./journey.types";

export type LocalizedName = Readonly<Record<SupportedLang, string>>;
export type RideMode = "shuttle" | "bus" | "expressBus" | "subway";

export interface JourneyLine {
  id: string;
  source: JourneySourceId;
  /** WHY: the source's own line: a shuttle service id (`campus-inja`), a TOPIS route id, a subway line. */
  sourceLineId: string;
  mode: RideMode;
  name: LocalizedName;
  /** WHY: hex6 without '#', as every served color. */
  color: string;
  /** WHY: an open key; the app draws one it does not know with the generic icon. */
  icon: string;
}

export interface WalkLeg {
  kind: "walk";
  from: string;
  to: string;
  minutes: number;
  distanceM: number;
  /** WHY: where the minutes come from (TMAP pedestrian on a date, or on site); never served. */
  evidence: string;
  path?: LatLng[];
}

export interface TransferLeg {
  kind: "transfer";
  at: string;
  fromPlatformId: string;
  toPlatformId: string;
  minutes: number;
  evidence: string;
}

export interface LegStop {
  place: string;
  /** WHY: the KRIC platform, on a subway station only. */
  platformId?: string;
}

/** WHY: from `from` (KST `HH:mm`) until the next band's start, or midnight for the last. */
export interface RideMinutesBand {
  from: string;
  minutes: number;
}

export interface RideLeg {
  kind: "ride";
  line: string;
  board: LegStop;
  alight: LegStop;
  /** WHY: read only when the door cannot place the run at the alight stop, outside every band of the board's day type. */
  rideMinutes: number;
  /** WHY: by the board's day type, a public holiday's being weekend; each list in order of `from`. */
  rideMinutesBands?: { weekday?: RideMinutesBand[]; weekend?: RideMinutesBand[] };
  evidence: string;
}

export type JourneyLeg = WalkLeg | TransferLeg | RideLeg;

export interface JourneyOption {
  id: string;
  name: LocalizedName;
  mode: RideMode;
  legs: JourneyLeg[];
}

export interface JourneyRoute {
  id: string;
  name: LocalizedName;
  from: string;
  to: string;
  /** WHY: in data order, which breaks an arrival tie. */
  options: JourneyOption[];
}

export interface JourneyRoutesData {
  /** WHY: how long before a call the rider must be at the stop to catch it. */
  catchMarginSec: number;
  lines: JourneyLine[];
  routes: JourneyRoute[];
}

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface JourneyRoutesDatasetDoc {
  _id: string;
  revision: number;
  data: JourneyRoutesData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredJourneyRoutes = Pick<JourneyRoutesDatasetDoc, "revision" | "data">;
