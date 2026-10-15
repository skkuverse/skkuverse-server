import Holidays from "date-holidays";
import moment from "moment-timezone";
import type { BusOverrideDoc, BusScheduleDoc } from "./bus-schedule.document";
import type { DaySources, PickedPattern, RestDays, SuspendWindow } from "./bus-schedule.types";
import type { ScheduleDay, ScheduleNotice } from "./bus-schedule.wire";

const DATE_FORMAT = "YYYY-MM-DD";
const WEEK_START_PARAM = /^\d{4}-\d{2}-\d{2}$/;

// QUIRK(date-holidays): computes KR holidays for any year, substitute holidays included; ad-hoc ones the
// library cannot predict go in skku-rest-days.json.
const krHolidays = new Holidays("KR");

export function isWeekStartParam(from: unknown): boolean {
  return from === undefined || WEEK_START_PARAM.test(String(from));
}

/** WHY: exact date first, then the yearly MM-DD rule. */
export function lookupRestDay(restDays: RestDays, dateStr: string): string | null {
  return restDays.exact.get(dateStr) ?? restDays.annual.get(dateStr.slice(5)) ?? null;
}

// WHY: the SKKU list wins over the public calendar; noon KST resolves the date whatever the host's time zone.
export function toNonOperatingDayLabel(restDays: RestDays, dateStr: string): string | null {
  const skku = lookupRestDay(restDays, dateStr);
  if (skku) return skku;
  const holidays = krHolidays.isHoliday(new Date(`${dateStr}T12:00:00+09:00`));
  return (holidays && holidays.find((h) => h.type === "public")?.name) || null;
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
