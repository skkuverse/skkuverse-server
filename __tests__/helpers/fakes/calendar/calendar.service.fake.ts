/**
 * CalendarService with a scripted calendar, for a feature that reads public
 * holidays through it: `names` maps a KST date (YYYY-MM-DD) to its holiday
 * name, and any other date is no holiday. How the real service answers a date
 * (stored years, the rules fallback, the RangeError) is
 * calendar.service.spec.ts's.
 */
import type { CalendarService } from "../../../../src/calendar/calendar.service";
import type { PublicOf } from "../public-of";

export class FakeCalendarService implements PublicOf<CalendarService> {
  names = new Map<string, string>();

  async publicHolidayName(dateStr: string): Promise<string | null> {
    return this.names.get(dateStr) ?? null;
  }

  async sync(): Promise<void> {}
}
