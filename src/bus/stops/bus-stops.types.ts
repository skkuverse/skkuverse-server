import type { I18n, SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { ServedSequenceStop, ServedStop } from "../bus.wire";

export interface StopPhoto {
  original: string;
  localized?: Partial<Record<SupportedLang, string>>;
}

export interface StopPanorama {
  panoId: string;
  pan: number;
  tilt: number;
  fov: number;
}

export interface GuidePlace {
  id: string;
  kind: "subwayExit";
  number: number;
  /** WHY: per language, since t() has no templating. */
  name: I18n;
  coords: LatLng;
}

/** WHY: in walking order: boarding stops walk to `"stop"`, drop-offs walk from it. */
export interface GuideWalk {
  from: string;
  to: string;
  path: LatLng[];
}

export interface StopGuide { places?: GuidePlace[]; walks?: GuideWalk[] }

export interface ScheduleStop {
  id: string;
  name: I18n;
  detail?: I18n;
  coords?: LatLng;
  photo?: StopPhoto;
  panorama?: StopPanorama;
  guide?: StopGuide;
}

export interface SequenceStop {
  stopId?: string;
  label?: I18n;
  /** WHY: the timetable's notes column at this stop, here because schedule responses are not localized. */
  note?: I18n;
  detail?: I18n;
  action: "board" | "alight";
  timing: "scheduled" | "estimated";
}

export interface ScheduleStopCatalog {
  stops: ScheduleStop[];
  /** WHY: serviceId → routeType → the stops of every run, in order; an entry's `stopTimes` follows it index for index. */
  sequences: Record<string, Record<string, SequenceStop[]>>;
}

export type EtaOptIns = ReadonlyMap<string, readonly string[]>;

export interface ResolvedStops {
  sequences: Record<string, Record<string, ServedSequenceStop[]>>;
  stops: ServedStop[];
}
