import type { JongroRouteIdentity, ServiceConfigEntry, ServiceConfigMap } from "./bus.types";

export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

export const JONGRO_ROUTE_ID_PREFIX = "jongro";

// WHY: identities only, in the app's order; each route's card, seat count and transfer lines are stored attributes.
export const JONGRO_ROUTES: ReadonlyArray<Readonly<JongroRouteIdentity>> = Object.freeze([
  Object.freeze({ id: "jongro02", busRouteId: "100900008" }),
  Object.freeze({ id: "jongro07", busRouteId: "100900004" }),
  Object.freeze({ id: "jongro08", busRouteId: "100900005" }),
]);

// QUIRK(hssc): toLinearSequence (src/bus/realtime/hssc) maps the API's circular stops onto this many positions,
// so the stored HSSC line holds exactly as many (unify-bus-stops design D3).
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

export const SERVICE_CONFIG: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
  },
  "commute-jeongja": commuteService(),
  "commute-jamsil": commuteService(),
  "commute-dogok": commuteService(),
  "commute-gangnam-yangjae": commuteService(),
  "commute-gwanggyo": commuteService(),
};
