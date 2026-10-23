export interface PublicHoliday {
  date: string;
  name: string;
}

export interface RestDays {
  exact: Map<string, string>;
  annual: Map<string, string>;
}

export interface RestDaysRevision {
  revision: number;
  restDays: RestDays;
}

export type Term = 1 | 2;

export interface Semester {
  term: Term;
  start: string;
  end: string;
}

export interface AcademicPeriod {
  kind: "semester" | "vacation";
  term: Term | null;
  source: "crawled" | "rule";
}

/** WHY: every date question a feature asks, answered for one KST date (YYYY-MM-DD). */
export interface CalendarDay {
  date: string;
  publicHoliday: string | null;
  schoolRestDay: string | null;
  academicPeriod: AcademicPeriod;
}

/** WHY: one read of every source a calendar day folds in but the public holidays, keyed by `revisionKey`. */
export interface CalendarSnapshot {
  revisionKey: string;
  dayOf(dateStr: string): Promise<CalendarDay>;
}
