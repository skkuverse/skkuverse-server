import type { ServiceConfigEntry, ServiceConfigMap } from "./bus.types";

export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

// WHY: two-digit codes as Seoul names village buses, so `jongro_locations_07` has no `_007` twin.
export const JONGRO_ROUTE_ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

export const JONGRO_ROUTE_ID_PREFIX = "jongro";

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
