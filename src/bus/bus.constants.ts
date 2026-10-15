import type { ServiceConfigMap } from "./bus.types";

export const KST_TIME_ZONE = "Asia/Seoul";

export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

// WHY: two-digit codes as Seoul names village buses, so `jongro_locations_07` has no `_007` twin.
export const JONGRO_ROUTE_ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

export const JONGRO_ROUTE_ID_PREFIX = "jongro";

// WHY: the commute shuttle's pilot window lives on its timetable patterns (scripts/data/commute-schedule.json), not here.
const COMMUTE_SERVICE = {
  nonOperatingDayDisplay: "hidden",
  // WHY: the pilot notice stays first: apps draw notices[0] as the banner.
  notices: [{ style: "info", text: "시범 운행 · 무료 · 킹고M QR 탑승" }],
  suspend: null,
  respectsKoreanHolidays: true,
};

export const SERVICE_CONFIG: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [{ style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요" }],
    suspend: null,
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [{ style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요" }],
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
  "commute-jeongja": COMMUTE_SERVICE,
  "commute-jamsil": COMMUTE_SERVICE,
  "commute-dogok": COMMUTE_SERVICE,
  "commute-gangnam-yangjae": {
    ...COMMUTE_SERVICE,
    // WHY: one bus serves both stations; the explicit line break keeps iOS from breaking a word.
    notices: [...COMMUTE_SERVICE.notices, { style: "info", text: "등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역" }],
  },
  "commute-gwanggyo": COMMUTE_SERVICE,
};
