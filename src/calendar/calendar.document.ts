import type { PublicHoliday, RestDays, Semester } from "./calendar.types";

export interface PublicHolidaysDoc {
  _id: number;
  holidays: PublicHoliday[];
  fetchedAt: Date;
}

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data): each key a MM-DD or YYYY-MM-DD, its
// value the label shown on the day; the server still parses it where it reads it.
export interface SkkuRestDaysDatasetDoc {
  _id: string;
  revision: number;
  data: Record<string, string>;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredRestDays = Pick<SkkuRestDaysDatasetDoc, "revision"> & { data: RestDays };

// CONTRACT(skkuverse-crawler): `AcademicYearDoc` of skkuverse-crawler/py/src/skkuverse_crawler/modules/schedule/models.py, one
// document per academic year in `academic_calendars`, keyed by the year as a string; the fields this server reads.
export interface AcademicCalendarDoc {
  _id: string;
  year: number;
  contentHash: string;
  semesters: Semester[];
  restDays: Array<{ date: string; title: string }>;
}
