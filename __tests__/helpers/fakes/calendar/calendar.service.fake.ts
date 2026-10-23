/**
 * CalendarService with a scripted calendar, for a feature that reads dates
 * through it: `names` maps a KST date (YYYY-MM-DD) to its public holiday name
 * (any other date is none, in every year), `restDayLabels` holds school rest
 * days keyed as the `skku-rest-days` dataset keys them (MM-DD yearly,
 * YYYY-MM-DD once) and read with the real lookup, `academicPeriod` is the
 * period every date answers, and `revision` is the revision key it answers. How the real service answers a date (stored years,
 * the rules fallback, the dataset's freshness and unavailability, the
 * RangeError) is calendar.service.spec.ts's.
 */
import { lookupRestDay, toRestDays } from "../../../../src/calendar/calendar.rules";
import type { CalendarService } from "../../../../src/calendar/calendar.service";
import type { AcademicPeriod, CalendarDay } from "../../../../src/calendar/calendar.types";
import type { PublicOf } from "../public-of";

export class FakeCalendarService implements PublicOf<CalendarService> {
  names = new Map<string, string>();
  restDayLabels: Record<string, string> = {};
  revision = "1";
  academicPeriod: AcademicPeriod = { kind: "vacation", term: null, source: "rule" };

  async publicHolidayName(dateStr: string): Promise<string | null> {
    return this.names.get(dateStr) ?? null;
  }

  async dayOf(dateStr: string): Promise<CalendarDay> {
    const schoolRestDay = lookupRestDay(toRestDays(this.restDayLabels), dateStr);
    return { date: dateStr, publicHoliday: this.names.get(dateStr) ?? null, schoolRestDay, academicPeriod: this.academicPeriod };
  }

  async revisionKey(): Promise<string> {
    return this.revision;
  }
}
