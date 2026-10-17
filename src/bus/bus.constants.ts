import type { ServiceConfigEntry, ServiceConfigMap, ServiceNotice } from "./bus.types";

export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

// WHY: two-digit codes as Seoul names village buses, so `jongro_locations_07` has no `_007` twin.
export const JONGRO_ROUTE_ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

export const JONGRO_ROUTE_ID_PREFIX = "jongro";

const COMMUTE_PILOT_NOTICE = { style: "info", text: "시범 운행 · 무료 · 킹고M QR 탑승" } as const;
const LIVE_TRAFFIC_NOTICE = { style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요" } as const;

// WHY: the commute shuttle's pilot window lives on its timetable patterns (scripts/data/commute-schedule.json), not
// here; a new entry per service, so a change to one (a suspension) leaves the others.
const commuteService = (routeNotices: ServiceNotice[] = []): ServiceConfigEntry => ({
  nonOperatingDayDisplay: "hidden",
  // WHY: the pilot notice stays first: apps draw notices[0] as the banner.
  notices: [{ ...COMMUTE_PILOT_NOTICE }, ...routeNotices, { ...LIVE_TRAFFIC_NOTICE }],
  suspend: null,
  respectsKoreanHolidays: true,
  eta: { routeTypes: ["up", "down"] },
});

export const SERVICE_CONFIG: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [{ ...LIVE_TRAFFIC_NOTICE }],
    suspend: null,
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [{ ...LIVE_TRAFFIC_NOTICE }],
    suspend: null,
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" },
    ],
    suspend: null,
  },
  "commute-jeongja": commuteService(),
  "commute-jamsil": commuteService(),
  "commute-dogok": commuteService(),
  // WHY: one bus serves both stations; the explicit line break keeps iOS from breaking a word.
  "commute-gangnam-yangjae": commuteService([{ style: "info", text: "등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역" }]),
  "commute-gwanggyo": commuteService(),
};
