import type { JongroRoute, JongroRouteCapabilities, ServiceConfigEntry, ServiceConfigMap } from "./bus.types";

export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

// EVIDENCE: TOPIS's dataTm advances about every 20 s (2026-10-17). SEE: docs/project-docs.md ("Daily Usage and Quota Check")
const JONGRO_POLL_INTERVAL_MS = 25_000;
const JONGRO_CAPABILITIES: JongroRouteCapabilities = Object.freeze({ positionSource: "gps", occupancy: true, plateNumber: true, lastBus: true, lowFloor: true });
const jongroRoute = (code: string, busRouteId: string): JongroRoute =>
  Object.freeze({ id: `jongro${code}`, code, busRouteId, capabilities: JONGRO_CAPABILITIES, isListed: true, pollIntervalMs: JONGRO_POLL_INTERVAL_MS });

// WHY: the TOPIS routes in the app's order; each route's card, seat count and transfer lines are stored attributes.
export const JONGRO_ROUTES: ReadonlyArray<JongroRoute> = Object.freeze([jongroRoute("02", "100900008"), jongroRoute("07", "100900004"), jongroRoute("08", "100900005")]);

// SEE: docs/explanation/bus-architecture.md ("Glossary"): a stop id names one pole, a TOPIS pole's derived from its ARS number.
export const STOP_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TOPIS_STOP_ID_PREFIX = "seoul-";
export const ARS_ID_PATTERN = /^\d{5}$/;

// WHY: the groups that serve stop sequences, their services in /bus/config's order, which the stop page follows.
export const STOP_SERVICE_IDS_BY_GROUP_ID = {
  campus: ["campus-inja", "campus-jain"],
  commute: ["commute-jeongja", "commute-jamsil", "commute-dogok", "commute-gangnam-yangjae", "commute-gwanggyo"],
} as const;

// QUIRK(hssc): toLinearSequence (src/bus/realtime/hssc) maps the API's circular stops onto this many positions,
// so the stored HSSC line holds exactly as many.
export const HSSC_POSITION_COUNT = 11;

// WHY: the live estimate poller runs every 60 s; an app refreshing estimates faster would only read its HTTP cache.
export const ESTIMATES_MAX_AGE_S = 60;

// WHY: the commute shuttle's pilot window lives on its timetable patterns (scripts/data/commute-schedule.json), its
// notices in the bus-service-notices dataset; a new entry per service, so a change to one leaves the others.
const commuteService = (): ServiceConfigEntry => ({
  nonOperatingDayDisplay: "hidden",
  respectsKoreanHolidays: true,
  eta: { routeTypes: ["up", "down"] },
});
const campusService = (): ServiceConfigEntry => ({ nonOperatingDayDisplay: "hidden", respectsKoreanHolidays: true, eta: { routeTypes: ["regular", "hakbu"] } });

export const SERVICE_CONFIG: ServiceConfigMap = {
  "campus-inja": campusService(),
  "campus-jain": campusService(),
  "fasttrack-inja": { nonOperatingDayDisplay: "hidden" },
  "commute-jeongja": commuteService(),
  "commute-jamsil": commuteService(),
  "commute-dogok": commuteService(),
  "commute-gangnam-yangjae": commuteService(),
  "commute-gwanggyo": commuteService(),
};
