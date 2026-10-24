import { z } from "zod";
import type { AcademicCalendarDoc, PublicHolidaysDoc, StoredRestDays } from "./calendar.document";
import { isCalendarDate } from "../shared/calendar-date.util";
import { isRestDayKey, isSemesterPair, toRestDays } from "./calendar.rules";

export const skkuRestDaysDataset = z
  .record(z.string(), z.string().min(1))
  .superRefine((labelByKey, ctx) => {
    for (const key of Object.keys(labelByKey)) {
      if (!isRestDayKey(key)) ctx.addIssue({ code: "custom", path: [key], message: "must be a calendar MM-DD or a calendar YYYY-MM-DD from 1900 to 2999" });
    }
  })
  .transform(toRestDays);

export const storedRestDays = z.object({ revision: z.int().positive(), data: skkuRestDaysDataset }) satisfies z.ZodType<StoredRestDays>;

const calendarDate = z.string().refine(isCalendarDate, { error: "must be a calendar date, YYYY-MM-DD" });

const semester = z.object({ term: z.union([z.literal(1), z.literal(2)]), start: calendarDate, end: calendarDate });

export const academicCalendarDoc = z
  .object({
    _id: z.string(),
    year: z.int(),
    contentHash: z.string().min(1),
    semesters: z.array(semester),
    restDays: z.array(z.object({ date: calendarDate, title: z.string().min(1) })),
  })
  .refine(({ _id, year }) => _id === String(year), { path: ["_id"], error: "must be the year" })
  .refine(({ year, semesters }) => isSemesterPair(year, semesters), {
    path: ["semesters"],
    error: "must be term 1 then term 2, each in order inside the academic year",
  }) satisfies z.ZodType<AcademicCalendarDoc>;

export const publicHolidaysDoc = z.object({
  _id: z.int(),
  holidays: z.array(z.object({ date: calendarDate, name: z.string() })),
  fetchedAt: z.date(),
}) satisfies z.ZodType<PublicHolidaysDoc>;
