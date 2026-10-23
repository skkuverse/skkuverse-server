import moment from "moment-timezone";
import type { CalendarDay } from "../../calendar/calendar.types";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import type { DaySources, PickedPattern, SuspendWindow } from "./bus-schedule.types";
import type { ScheduleDay, ScheduleNotice } from "./bus-schedule.wire";

const DATE_FORMAT = "YYYY-MM-DD";

// WHY: each Monday asked for costs a cached week and two reads, and date-holidays hangs on an invalid date or a
// far year, so the week view answers a real date within a year of today (KST) either way.
export function isWeekStartInRange(from: string, now: Date): boolean {
  const day = moment.tz(from, DATE_FORMAT, true, KST_TIME_ZONE);
  const today = moment(now).tz(KST_TIME_ZONE).startOf("day");
  return day.isValid() && !day.isBefore(today.clone().subtract(1, "year")) && !day.isAfter(today.clone().add(1, "year"));
}

// SEE: docs/decisions/0021-academic-calendar.md ("D4. The dataset overrides the crawl"): the dataset's rest day, then
// the public holiday, then the crawled rest day.
export function toNonOperatingDayLabel({ schoolRestDay, publicHoliday }: Pick<CalendarDay, "schoolRestDay" | "publicHoliday">): string | null {
  if (schoolRestDay?.source === "dataset") return schoolRestDay.label;
  return publicHoliday || schoolRestDay?.label || null;
}

/** WHY: a day the smart view may open on: one with a timetable, or a no-service day that carries notices. */
export function isSelectable(day: ScheduleDay): boolean {
  return day.display === "schedule" || (day.display === "noService" && day.notices.length > 0);
}

/** WHY: dates are YYYY-MM-DD, so string order is date order. */
export function isPatternInEffect(pattern: BusScheduleDoc, dateStr: string, dayOfWeek: number): boolean {
  return (
    pattern.days.includes(dayOfWeek) &&
    (pattern.effectiveFrom === undefined || pattern.effectiveFrom <= dateStr) &&
    (pattern.effectiveUntil === undefined || dateStr <= pattern.effectiveUntil)
  );
}

// WHY: two patterns on one date are a data error; the latest effectiveFrom wins (absent counts as earliest),
// patternId breaks a tie, so every replica serves the same timetable whatever order Mongo returns.
export function pickPattern(patterns: readonly BusScheduleDoc[], dateStr: string, dayOfWeek: number): PickedPattern<BusScheduleDoc> {
  const applying = patterns.filter((p) => isPatternInEffect(p, dateStr, dayOfWeek));
  if (applying.length <= 1) return { pattern: applying[0], conflicting: null };
  const sorted = [...applying].sort(
    (a, b) => (b.effectiveFrom ?? "").localeCompare(a.effectiveFrom ?? "") || a.patternId.localeCompare(b.patternId),
  );
  return { pattern: sorted[0], conflicting: sorted };
}

function overrideDay(override: BusOverrideDoc, serviceNotices: readonly ScheduleNotice[]): Omit<ScheduleDay, "date" | "dayOfWeek"> {
  const notices = override.notices.map((n) => ({ ...n, source: "override" }));
  // WHY: a no-service day shows only its own notices; "no weekend service" is noise on a day without service.
  if (override.type === "noService") return { display: "noService", label: override.label, notices, schedule: [] };
  return { display: "schedule", label: override.label, notices: [...serviceNotices, ...notices], schedule: override.entries };
}

/** WHY: precedence: an override, then a rest day or holiday, then the pattern in effect, then the fallback display. */
export function toDay(date: moment.Moment, sources: DaySources): ScheduleDay {
  const { override, restDayLabel, pattern, serviceNotices, config } = sources;
  const head = { date: date.format(DATE_FORMAT), dayOfWeek: date.isoWeekday() };
  if (override) {
    const { display, label, notices, schedule } = overrideDay(override, serviceNotices);
    return { ...head, display, label, notices, schedule };
  }
  if (restDayLabel) return { ...head, display: "noService", label: restDayLabel, notices: [], schedule: [] };
  if (pattern) return { ...head, display: "schedule", label: null, notices: [...serviceNotices], schedule: pattern.entries };
  return { ...head, display: config.nonOperatingDayDisplay, label: null, notices: [], schedule: [] };
}

/** WHY: null when the service has no suspension window; resumeDate null when today is outside it. */
export function toSuspendWindow(suspend: unknown, today: moment.Moment): SuspendWindow | null {
  if (!suspend || typeof suspend !== "object") return null;
  const { from, until } = suspend as { from?: string; until?: string };
  if (!from || !until) return null;
  const fromDay = moment(from, DATE_FORMAT, true);
  const untilDay = moment(until, DATE_FORMAT, true);
  if (!fromDay.isValid() || !untilDay.isValid() || fromDay.isAfter(untilDay)) return { invalid: true };
  const resumeDate = today.isBetween(fromDay, untilDay, "day", "[]") ? untilDay.clone().add(1, "day").format(DATE_FORMAT) : null;
  return { invalid: false, resumeDate };
}

export function firstSelectableDate(days: readonly ScheduleDay[], fromIndex: number): string | null {
  return days.slice(fromIndex).find(isSelectable)?.date ?? null;
}

// WHY: a copy, because the week cache holds the day by reference and the week view serves it as stored.
export function toSuspendedDay(day: ScheduleDay, suspend: unknown): ScheduleDay {
  const window = toSuspendWindow(suspend, moment.tz(day.date, DATE_FORMAT, KST_TIME_ZONE));
  if (!window || window.invalid || !window.resumeDate) return day;
  return { ...day, display: "noService", label: null, notices: [], schedule: [] };
}
