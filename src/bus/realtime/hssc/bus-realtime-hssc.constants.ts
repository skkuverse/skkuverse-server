export const HSSC_EVENT_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

// QUIRK(hssc): get_date is Korean-locale local time, its AM/PM marker in Korean.
export const HSSC_API_DATE_FORMAT = "YYYY-MM-DD a h:mm:ss";

// WHY: the turnaround stop gets a tighter window; a bus that waits there longer has ended its run.
export const TURNAROUND_STATION_NAME = "농구장 (셔틀버스정류소)";

export const STALE_MINUTES_AT_TURNAROUND = 3;

export const STALE_MINUTES = 10;

// QUIRK(hssc): the API's stop names, mapped to the names the app shows.
export const STATION_NAME_BY_HSSC_NAME: ReadonlyMap<string, string> = new Map([
  ["혜화역 1번출구 셔틀버스 정류소", "혜화역 1번출구 (셔틀버스정류소)"],
  ["혜화동로터리", "혜화동로터리 [미정차]"],
  ["성균관대입구사거리", "성균관대입구사거리"],
  ["문묘입구[정문]-등교", "정문"],
  ["600주년기념관 앞-등교", "600주년기념관"],
  ["농구장정류소", "농구장 (셔틀버스정류소)"],
  ["문묘입구[정문]-하교", "정문"],
  ["올림픽기념국민생활관", "올림픽기념국민생활관 [하차전용]"],
  ["600주년기념관 앞-하교", "600주년기념관"],
  ["서울혜화동우체국", "혜화동우체국 [하차전용]"],
]);
