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

/** WHY: every date question a feature asks, answered for one KST date (YYYY-MM-DD). */
export interface CalendarDay {
  date: string;
  publicHoliday: string | null;
  schoolRestDay: string | null;
}
