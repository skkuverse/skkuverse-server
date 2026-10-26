import type { ArrivalStatePhrases, Crowding } from "./bus-realtime-arrival.types";

// QUIRK(topis): states only the text carries, tested in this order by substring, so a form with a bracket
// prefix still matches and the departure-wait phrase never reads as a departure time.
export const ARRIVAL_STATE_PHRASES: ArrivalStatePhrases = [
  ["ended", ["운행종료", "운행중단", "막차운행종료"]],
  ["waiting", ["출발대기", "운행대기", "회차대기", "회차지", "차고지"]],
  ["noInfo", ["정보없음", "도착정보 없음"]],
  ["arriving", ["곧 도착", "진입", "잠시후"]],
];

// QUIRK(topis): the last-bus token, the stops-away token and other bracket tokens sit before or after the time.
// WHY: a body without `[` and of bounded length keeps each try linear on text TOPIS did not shape (CWE-1333).
export const BRACKET_TOKEN_PATTERN = /\[[^[\]]{0,20}\]/g;

// QUIRK(topis): the last bus carries this word as a bracket token or as a bare prefix before the time.
export const LAST_BUS_WORD = "막차";

// QUIRK(topis): minutes and seconds, minutes alone or seconds alone, then "after", with or without spaces.
// WHY: bounded digit runs and no two adjacent whitespace runs keep the match linear (CWE-1333).
export const TIMED_TEXT_PATTERN = /(?<!\d)(?:(\d{1,3})\s*분(?:\s*(\d{1,3})\s*초)?|(\d{1,3})\s*초)\s*후/;

export const NO_VEHICLE_ID = "0";

// QUIRK(topis): rerdie_Div 2 makes reride_Num the on-board passenger count, 4 a congestion code.
export const PASSENGER_COUNT_TYPE = 2;
export const CONGESTION_CODE_TYPE = 4;

export const CROWDING_BY_CONGESTION_CODE: Readonly<Record<number, Crowding>> = {
  3: "relaxed",
  4: "normal",
  5: "crowded",
};

// EVIDENCE: Seoul's 2024 bus crowding rule: relaxed up to the seat count, normal up to 1.5 times it.
export const NORMAL_CROWDING_SEAT_RATIO = 1.5;
