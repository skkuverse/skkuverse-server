import type { ServiceConfigMap } from "../types";

/**
 * Static config mapping serviceId → operational defaults.
 * Used by the resolution engine when no schedule pattern or override matches.
 */
const serviceConfig: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
    suspend: null,
    respectsKoreanHolidays: true,
    eta: { routeTypes: ["regular", "hakbu"] },
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [],
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
  // 자과캠 통학셔틀, a pilot from 2026-10-20 to 2026-12-18: one service per
  // route. The pilot window itself lives on the timetable patterns
  // (scripts/data/commute-schedule.json), not here.
  ...Object.fromEntries(
    [
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ].map((serviceId) => [
      serviceId,
      {
        nonOperatingDayDisplay: "hidden",
        notices: [
          // The pilot notice stays first: apps draw notices[0] as the banner.
          { style: "info", text: "시범 운행 · 무료 · 킹고M QR 탑승" },
          // One bus serves both stations; the explicit line break keeps iOS
          // from breaking a word in the middle.
          ...(serviceId === "commute-gangnam-yangjae"
            ? [{ style: "info", text: "등교: 강남역 → 양재역 → 자과캠\n하교: 자과캠 → 양재역 → 강남역" }]
            : []),
        ],
        suspend: null,
        respectsKoreanHolidays: true,
      },
    ]),
  ),
};

export default serviceConfig;
