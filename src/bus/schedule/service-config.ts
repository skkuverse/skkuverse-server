import type { ServiceConfigMap } from "../types";

/**
 * Static config mapping serviceId → operational defaults.
 * Used by the resolution engine when no schedule pattern or override matches.
 */
const serviceConfig: ServiceConfigMap = {
  "campus-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "주말, 공휴일, 학교 휴일 운행 없음" },
    ],
    suspend: null,
    respectsKoreanHolidays: true,
  },
  "campus-jain": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "info", text: "주말, 공휴일, 학교 휴일 운행 없음" },
    ],
    suspend: null,
    respectsKoreanHolidays: true,
  },
  "fasttrack-inja": {
    nonOperatingDayDisplay: "hidden",
    notices: [
      { style: "warning", text: "ESKARA 기간 한정 운행" },
    ],
    suspend: null,
  },
  // 자과캠 통학셔틀, a pilot from 2026-10-19 to 2026-12-18: one service per
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
        notices: [{ style: "info", text: "시범 운행 · 무료 · 킹고M QR 탑승" }],
        suspend: null,
        respectsKoreanHolidays: true,
      },
    ]),
  ),
};

export default serviceConfig;
