import type { ServiceConfigMap } from "../types";

/**
 * Static config mapping serviceId → operational defaults.
 * Used by the resolution engine when no schedule pattern or override matches.
 */
const serviceConfig: ServiceConfigMap = {
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
  // WHY: the 자과캠 통학셔틀 pilot window lives on its timetable patterns
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
