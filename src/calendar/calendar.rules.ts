import moment from "moment-timezone";
import { isCalendarDate } from "../shared/calendar-date.util";
import {
  ACADEMIC_YEAR_FIRST_DAY,
  DAYS_BACK_TO_NEAREST_MONDAY,
  LEAP_YEAR,
  REST_DAY_YEARS,
  TERM_ONE_EARLIEST_DAY,
  TERM_TWO_ANCHOR_DAY,
  TERM_WEEKS,
} from "./calendar.constants";
import type { AcademicPeriod, RestDays, Semester, Term } from "./calendar.types";

const DATE_FORMAT = "YYYY-MM-DD";
const LAST_WEEKDAY = 5;
const DAYS_PER_WEEK = 7;

const ANNUAL_KEY = /^\d{2}-\d{2}$/;
const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** WHY: MM-DD recurs every year, YYYY-MM-DD applies once; the key's shape says which. */
export function isRestDayKey(key: string): boolean {
  if (ANNUAL_KEY.test(key)) return isCalendarDate(`${LEAP_YEAR}-${key}`);
  if (!EXACT_KEY.test(key) || !isCalendarDate(key)) return false;
  const year = Number(key.slice(0, 4));
  return year >= REST_DAY_YEARS.first && year <= REST_DAY_YEARS.last;
}

export function toRestDays(labelByKey: Readonly<Record<string, string>>): RestDays {
  const restDays: RestDays = { exact: new Map(), annual: new Map() };
  for (const [key, label] of Object.entries(labelByKey)) (ANNUAL_KEY.test(key) ? restDays.annual : restDays.exact).set(key, label);
  return restDays;
}

/** WHY: exact date first, then the yearly MM-DD rule. */
export function lookupRestDay(restDays: RestDays, dateStr: string): string | null {
  return restDays.exact.get(dateStr) ?? restDays.annual.get(dateStr.slice(5)) ?? null;
}

/** WHY: an academic year runs from March 1 to the last day of February, as SKKU and the crawler count it. */
export function toAcademicYear(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  return dateStr.slice(5) >= ACADEMIC_YEAR_FIRST_DAY ? year : year - 1;
}

/** WHY: dates are YYYY-MM-DD, so string order is date order. */
export function isSemesterPair(year: number, semesters: readonly Semester[]): boolean {
  const [termOne, termTwo] = semesters;
  return semesters.length === 2 && termOne?.term === 1 && termTwo?.term === 2 && isInOrderWithin(year, termOne, termTwo);
}

function isInOrderWithin(year: number, termOne: Semester, termTwo: Semester): boolean {
  const [first, next] = [`${year}-${ACADEMIC_YEAR_FIRST_DAY}`, `${year + 1}-${ACADEMIC_YEAR_FIRST_DAY}`];
  return first <= termOne.start && termOne.start <= termOne.end && termOne.end < termTwo.start && termTwo.start <= termTwo.end && termTwo.end < next;
}

// SEE: docs/decisions/0021-academic-calendar.md ("D3. The default rule")
export function toRuleSemesters(year: number, isPublicHoliday: (dateStr: string) => boolean): Semester[] {
  return [toRuleSemester(1, toTermOneStart(year, isPublicHoliday)), toRuleSemester(2, toTermTwoStart(year))];
}

export function toAcademicPeriod(dateStr: string, semesters: readonly Semester[], source: AcademicPeriod["source"]): AcademicPeriod {
  const semester = semesters.find(({ start, end }) => start <= dateStr && dateStr <= end);
  return semester ? { kind: "semester", term: semester.term, source } : { kind: "vacation", term: null, source };
}

const isWeekend = (day: moment.Moment): boolean => day.isoWeekday() > LAST_WEEKDAY;

// EVIDENCE: 2026 opened on 03-02, a substitute holiday, and 2025 on the day after its substitute holiday 03-03
// (the crawled calendars of 2024 to 2026).
function toTermOneStart(year: number, isPublicHoliday: (dateStr: string) => boolean): moment.Moment {
  const day = moment.utc(`${year}-${TERM_ONE_EARLIEST_DAY}`, DATE_FORMAT, true);
  if (!isWeekend(day)) return day;
  while (isWeekend(day) || isPublicHoliday(day.format(DATE_FORMAT))) day.add(1, "day");
  return day;
}

function toTermTwoStart(year: number): moment.Moment {
  const anchor = moment.utc(`${year}-${TERM_TWO_ANCHOR_DAY}`, DATE_FORMAT, true);
  const daysSinceMonday = anchor.isoWeekday() - 1;
  return daysSinceMonday <= DAYS_BACK_TO_NEAREST_MONDAY ? anchor.subtract(daysSinceMonday, "days") : anchor.add(DAYS_PER_WEEK - daysSinceMonday, "days");
}

function toRuleSemester(term: Term, start: moment.Moment): Semester {
  const end = start.clone().add(TERM_WEEKS, "weeks").subtract(1, "day");
  while (isWeekend(end)) end.subtract(1, "day");
  return { term, start: start.format(DATE_FORMAT), end: end.format(DATE_FORMAT) };
}
