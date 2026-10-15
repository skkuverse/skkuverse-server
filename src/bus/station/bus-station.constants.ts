import type { HsscEtaStation } from "./bus-station.types";

export const HYEHWA_STOP_ID = "01592";

export const HYEHWA_STATION_NAME = "혜화역(승차장)";

export const NO_STATION_MESSAGE = "정보 없음";

export const NO_ARRIVAL = "도착 정보 없음";

export const ARRIVING = "도착 또는 출발";

export const POLL_INTERVAL_MS = 40_000;

// WHY: the terminal: a stale bus waiting there is skipped when looking for the next one.
export const LAST_STATION_SEQUENCE = 10;

// WHY: a bus at the stop longer than this has left in all but name, so the bus behind it answers.
export const STALE_THRESHOLD_SECONDS = 60;

const station = (sequence: number, stationName: string): HsscEtaStation => ({ sequence, stationName });

// (An operations detail is left out of the public history.)
export const HSSC_ETA_STATIONS: readonly HsscEtaStation[] = [
  station(1, "정차소(인문.농구장)"),
  station(2, "학생회관(인문)"),
  station(3, "정문(인문-하교)"),
  station(4, "혜화로터리(하차지점)"),
  station(5, "혜화역U턴지점"),
  station(6, HYEHWA_STATION_NAME),
  station(7, "혜화로터리(경유)"),
  station(8, "맥도날드 건너편"),
  station(9, "정문(인문-등교)"),
  station(10, "600주년 기념관"),
];
