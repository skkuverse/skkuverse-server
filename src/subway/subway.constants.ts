import type { SubwayStation } from "./subway.types";

// WHY: an approaching train is taken to arrive this long after its approach was shown (design D4).
export const APPROACH_LEAD_MS = 30_000;

// SEE: docs/explanation/subway-architecture.md ("Structure"): what adding a station touches.
export const SUBWAY_STATIONS: readonly SubwayStation[] = [
  {
    id: "KR-1-0153",
    operatorCode: "KR", lineCode: "1", stationCode: "0153",
    name: { ko: "성균관대", en: "Sungkyunkwan Univ.", zh: "成均馆大学" },
    directions: {
      up: {
        name: { ko: "서울 방면", en: "Toward Seoul", zh: "首尔方向" },
        upstreamStationIds: ["KR-1-P154", "KR-1-P155", "KR-1-1715"], nextStationId: "KR-1-P152",
      },
      down: {
        name: { ko: "천안·서동탄 방면", en: "Toward Cheonan / Seodongtan", zh: "天安·西东滩方向" },
        upstreamStationIds: ["KR-1-P152", "KR-1-P151", "KR-1-P150"], nextStationId: "KR-1-P154",
      },
    },
    seoul: { subwayId: "1001", stationName: "성균관대", trainMapLine: "1", timetable: { source: "korail" } },
  },
  {
    id: "S1-4-420",
    operatorCode: "S1", lineCode: "4", stationCode: "420",
    name: { ko: "혜화", en: "Hyehwa", zh: "惠化" },
    directions: {
      up: {
        name: { ko: "불암산·진접 방면", en: "Toward Buramsan / Jinjeop", zh: "佛岩山·榛接方向" },
        upstreamStationIds: ["S1-4-421", "S1-4-422", "S1-4-423"], nextStationId: "S1-4-419",
      },
      down: {
        name: { ko: "오이도·안산 방면", en: "Toward Oido / Ansan", zh: "乌耳岛·安山方向" },
        upstreamStationIds: ["S1-4-419", "S1-4-418", "S1-4-417"], nextStationId: "S1-4-421",
      },
    },
    seoul: { subwayId: "1004", stationName: "혜화", trainMapLine: "4", timetable: { source: "seoul-station", stationCode: "0420" } },
  },
];
