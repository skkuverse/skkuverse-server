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

// WHY: they hold the first and last trains of every served platform in the official timetables (05:07 to 25:00
// on weekdays, 24:22 on holidays), in seconds after 00:00 KST of the service date, so a close past midnight is past 86400.
export const SERVICE_WINDOW_OPENS_SEC = 5 * HOUR_SEC;
export const SERVICE_WINDOW_CLOSES_SEC: Readonly<Record<DayType, number>> = {
  weekday: 25 * HOUR_SEC + 10 * MINUTE_SEC,
  saturday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
  holiday: 24 * HOUR_SEC + 30 * MINUTE_SEC,
};

export const SUBWAY_TIMETABLES_DATASET = "subway-timetables";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const TIMETABLES_LOG_INTERVAL_MS = 60_000;

// WHY: the longest horizon the estimate is measured at (PREDICTION_HORIZONS_MIN in history/, which timetable may not
// import): a train due within it should be seen on its own, not lent a delay.
export const MIN_VIEW_BEFORE_PLATFORM_SEC = 10 * MINUTE_SEC;

// EVIDENCE: the longest run of the committed tables between two stops of one train with no stop between them, the
// line 1 express from Geumjeong to Sungkyunkwan Univ.; between two adjacent stations 420 s (Cheonggyesan to Pangyo).
export const MAX_UNOBSERVED_RUN_SEC = 510;

// WHY: a run starting here carries an arrival in its first row: convert.py writes arrival = departure at a Shinbundang
// run's first stop, and each line 2 inner-circle lap starts at Seongsu, untracked because an outer-circle lap starts
// there too under the number it reaches Jamsil with.
export const RUN_START_PLATFORM_IDS: readonly string[] = ["DX-D1-D04", "DX-D1-4319", "DX-D1-4311", "DX-D1-4312", "S1-2-212"];

// WHY: adjacent stations whose codes are not consecutive: an id frozen at first use and the codes the 2026-05-11 KRIC
// list skips.
export const ADJACENT_PLATFORM_ID_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["KR-1-P157", "KR-1-1715"],
  ["KR-1-1715", "KR-1-P155"],
  ["S1-8-2809", "S1-8-2811"],
  ["S1-8-2821", "S1-8-2828"],
];
