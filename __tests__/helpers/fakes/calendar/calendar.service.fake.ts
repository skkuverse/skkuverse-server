/**
 * CalendarService with a scripted calendar, for a feature that reads dates
 * through it: `names` maps a KST date (YYYY-MM-DD) to its public holiday name
 * (any other date is none, in every year), `restDayLabels` holds school rest
 * days keyed as the `skku-rest-days` dataset keys them (MM-DD yearly,
 * YYYY-MM-DD once) and read with the real lookup, `academicPeriod` is the
 * period every date answers, and `revision` is the revision key a snapshot
 * carries. A snapshot reads the scripted values when asked. How the real
 * service answers a date (stored years, the rules fallback, the dataset's
 * freshness and unavailability, the RangeError, one read per snapshot) is
 * calendar.service.spec.ts's.
 */
import { lookupRestDay, toRestDays } from "../../../../src/calendar/calendar.rules";
import type { CalendarService } from "../../../../src/calendar/calendar.service";
import type { AcademicPeriod, CalendarDay, CalendarSnapshot } from "../../../../src/calendar/calendar.types";
import type { PublicOf } from "../public-of";

export class FakeCalendarService implements PublicOf<CalendarService> {
  names = new Map<string, string>();
  restDayLabels: Record<string, string> = {};
  revision = "1";
  academicPeriod: AcademicPeriod = { kind: "vacation", term: null, source: "rule" };

  async publicHolidayName(dateStr: string): Promise<string | null> {
    return this.names.get(dateStr) ?? null;
  }

  async current(): Promise<CalendarSnapshot> {
    return { revisionKey: this.revision, dayOf: async (dateStr) => this.dayOf(dateStr) };
  }

  private dayOf(dateStr: string): CalendarDay {
    const label = lookupRestDay(toRestDays(this.restDayLabels), dateStr);
    const schoolRestDay = label === null ? null : { label, source: "dataset" as const };
    return { date: dateStr, publicHoliday: this.names.get(dateStr) ?? null, schoolRestDay, academicPeriod: this.academicPeriod };
  }
}
