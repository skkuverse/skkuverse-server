import type { DayType, TimetableSource } from "./subway-timetable.types";

// WHY: the same start as SERVICE_DAY_START in scripts/subway-timetable/convert.py, which writes a clock time
// before it as the previous service day's, past 86400.
export const SERVICE_DAY_START_HOUR = 3;

export const TIMETABLE_DAY_TYPES: Readonly<Record<TimetableSource, readonly DayType[]>> = {
  korail: ["weekday", "holiday"],
  "seoul-station": ["weekday", "saturday", "holiday"],
  shinbundang: ["weekday", "holiday"],
};

const HOUR_SEC = 3600;
const MINUTE_SEC = 60;

// WHY: the first and last trains of both stations in the official timetables (design D7), in seconds after
// 00:00 KST of the service date, as the timetables count them, so a close past midnight is past 86400.
export const SERVICE_WINDOW_OPENS_SEC = 5 * HOUR_SEC;
export const SERVICE_WINDOW_CLOSES_SEC: Readonly<Record<DayType, number>> = {
  weekday: 25 * HOUR_SEC + 10 * MINUTE_SEC,
  saturday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
  holiday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
};
