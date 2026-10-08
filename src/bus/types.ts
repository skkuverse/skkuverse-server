/**
 * External bus API response types. Derived from `__fixtures__/<date>/*.json`
 * (real captured responses, ~one month of snapshots).
 *
 * Strategy: type only the fields the codebase reads; expose unused fields via
 * an `unknown` index signature so future use sites can add types as needed
 * without churning the wrapper. Defensive narrowing happens inside fetchers.
 */
import type { I18n, SupportedLang } from "../infra/types";

// --- HSSC (campus shuttle, custom university API) ---
// Response is a bare JSON array. No envelope.
export interface HsscBusItem {
  line_no: string;
  // Direction/status marker — observed values across one month of fixtures:
  // "LEFT", "ENTERED", "EMERGENCY", "LEFT_LAST". Not narrowed to a union
  // because the server could introduce others; fetcher does not branch on
  // this field (it only uses stop_name for filtering decisions).
  inout: string;
  stop_no: string;
  // Circular index "0".."10". Fetcher converts to linear sequence via parseInt.
  seq: string;
  stop_name: string;
  // Korean locale datetime like "2026-03-16 오전 11:58:06". Parsed by moment-timezone.
  get_date: string;
}

// --- Seoul TOPIS bus API (Jongro 02 / 07) ---
// Envelope shared by both list and location endpoints. Observed behaviors
// across one month of __fixtures__:
//   headerCd "0"  → success, itemList is a (possibly empty) array
//   headerCd "4"  → "결과가 없습니다." (no result, e.g. overnight) → itemList is NULL
//   other codes  → upstream error; fetcher should log + skip cache write
// Defensive narrowing: treat msgBody / itemList as possibly missing.
export interface SeoulBusEnvelope<TItem> {
  comMsgHeader?: {
    successYN: string | null;
    returnCode: string | null;
    responseMsgID: string | null;
    errMsg: string | null;
    responseTime: string | null;
    requestMsgID: string | null;
  };
  msgHeader?: {
    headerMsg: string;
    headerCd: string; // "0" success, "4" no-result, others = error
    itemCount: number;
  };
  msgBody?: {
    itemList: TItem[] | null;
  };
}

// Jongro bus *list* — per-route station sequence with first-bus ETA.
// Real responses have 50+ fields; we read 7. The rest are exposed via index sig.
export interface JongroListItem {
  stId: string;
  staOrd: string;
  stNm: string;
  plainNo1: string;
  mkTm: string;
  arsId: string;
  arrmsg1: string;
  [k: string]: unknown;
}

// Jongro bus *location* — real-time positions per running vehicle.
export interface JongroLocItem {
  lastStnId: string;
  tmX: string;
  tmY: string;
  plainNo: string;
  [k: string]: unknown;
}

export type JongroListResponse = SeoulBusEnvelope<JongroListItem>;
export type JongroLocResponse = SeoulBusEnvelope<JongroLocItem>;

// --- Internal station/route shapes (served to the client) ---

export interface TransferLine {
  line: string;
  color: string;
}

interface BusStationBase {
  stationName: string;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  busType: string;
  transferLines: TransferLine[];
}

// HSSC: numeric sequence, includes English subtitle.
export interface HsscStation extends BusStationBase {
  sequence: number;
  subtitle: string;
}

// Jongro: string sequence. Display shape derived from JongroRouteStation
// (registry). Vestigial fields (`eta` placeholder, `busType`) intentionally
// dropped — neither was read by served output (`mapStations`, realtime route)
// per grep audit during the registry refactor.
export interface JongroStation
  extends Omit<BusStationBase, "busType"> {
  sequence: string;
}

// Raw shape in `jongro-routes.json`. The registry derives the display
// (`JongroStation` with sequence = idx+1, stationNumber = arsId) and the
// TOPIS mapping (topisId → { sequence, stationName }) from this single
// source of truth.
export interface JongroRouteStation {
  stationName: string;
  arsId: string;
  topisId: string;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: TransferLine[];
}

export interface JongroRouteConfig {
  id: string;
  busRouteId: string;
  themeColor: string;
  iconType: string;
  refreshInterval: number;
  stations: JongroRouteStation[];
}

// Mapping from TOPIS lastStnId → { sequence, stationName } used by fetcher.
export interface JongroStationMapping {
  [lastStnId: string]: {
    sequence: number;
    stationName: string;
  };
}

// service-config.ts
export interface ServiceNotice {
  style: "info" | "warning" | "error" | string;
  text: string;
}
export interface ServiceConfigEntry {
  nonOperatingDayDisplay: "hidden" | "visible" | string;
  notices: ServiceNotice[];
  // Always null in observed data; shape TBD if we ever populate.
  suspend: null | unknown;
  // Opt-in: when true, Korean public holidays + SKKU rest days resolve to
  // display:"noService" (see holiday-calendar.ts). Default off so adding a
  // new shuttle never silently suppresses its schedule.
  respectsKoreanHolidays?: boolean;
}
export type ServiceConfigMap = Record<string, ServiceConfigEntry>;

// Route overlay coords: [latitude, longitude][]
export type RouteCoords = Array<[number, number]>;

// --- Naver Directions API (driving ETA between campuses) ---
export interface NaverDirectionsSummary {
  duration: number;
  distance: number;
  [k: string]: unknown;
}
export interface NaverDirectionsResponse {
  code: number;
  message: string;
  route?: {
    traoptimal?: Array<{
      summary: NaverDirectionsSummary;
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };
}

// --- MongoDB documents (bus_overrides, bus_schedules) ---
// `entries` and `notices` are typed as required even though they're only
// strictly needed on `type: "replace"`, on the assumption that admin
// tooling produces well-formed docs — a malformed
// override doc throws at runtime (fail-loud), which is intentional: the
// alert reaches ops via logger.error instead of silently degrading.
export interface BusOverrideDoc {
  serviceId: string;
  date: string; // YYYY-MM-DD
  type: "replace" | "noService";
  entries: unknown[];
  label?: string | null;
  notices: ServiceNotice[];
}

export interface BusScheduleDoc {
  serviceId: string;
  patternId: string;
  days: number[]; // isoWeekday list (1-7)
  entries: unknown[];
  // Inclusive YYYY-MM-DD bounds. A missing bound is open, so a pattern with
  // neither applies on every listed weekday, as before ranges existed.
  effectiveFrom?: string;
  effectiveUntil?: string;
}

// --- Boarding-stop catalog (src/bus/schedule/schedule-stops.json) ---

export interface LatLng {
  lat: number;
  lng: number;
}

/** An original capture plus overlay variants whose labels are in one language. */
export interface StopPhoto {
  original: string;
  localized?: Partial<Record<SupportedLang, string>>;
}

/** A NAVER street view frame: which panorama, and where the view points. */
export interface StopPanorama {
  panoId: string;
  pan: number;
  tilt: number;
  fov: number;
}

export interface StopExit {
  number: number;
  coords: LatLng;
}

export interface ScheduleStop {
  id: string;
  name: I18n;
  detail?: I18n;
  coords?: LatLng;
  photo?: StopPhoto;
  panorama?: StopPanorama;
  // Set together: the subway exit riders walk from, and the path from it.
  exit?: StopExit;
  walkPath?: LatLng[];
}

/**
 * One stop of a run, in the order the bus reaches it. Either a catalog stop
 * (which brings its photo, street view and exit) or a plain label. `timing`
 * says whether the time the timetable gives for this stop is the published
 * schedule or the school's estimate.
 */
export interface SequenceStop {
  stopId?: string;
  label?: I18n;
  // The timetable's notes column at this stop ("강남역 탑승"). It lives here, in
  // the language-aware config, because schedule responses are not localized.
  note?: I18n;
  detail?: I18n;
  action: "board" | "alight";
  timing: "scheduled" | "estimated";
}

export interface ScheduleStopCatalog {
  stops: ScheduleStop[];
  // serviceId → routeType → the stops of every run of that route type, in
  // order. An entry's `stopTimes` gives the time at each, index for index.
  sequences: Record<string, Record<string, SequenceStop[]>>;
}
