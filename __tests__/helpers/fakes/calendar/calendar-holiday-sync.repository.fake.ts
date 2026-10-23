/**
 * In-memory CalendarHolidaySyncRepository: upsertYear replaces the document of its
 * year in `years`, as the real upsert keyed by the year does (pinned in
 * calendar-holiday-sync.repository.spec.ts). `failWith` makes every write reject.
 */
import type { PublicHolidaysDoc } from "../../../../src/calendar/calendar.document";
import type { PublicHoliday } from "../../../../src/calendar/calendar.types";
import type { CalendarHolidaySyncRepository } from "../../../../src/calendar/holiday-sync/calendar-holiday-sync.repository";
import type { PublicOf } from "../public-of";

export class FakeCalendarHolidaySyncRepository implements PublicOf<CalendarHolidaySyncRepository> {
  years = new Map<number, PublicHolidaysDoc>();
  failWith: Error | null = null;

  async upsertYear(year: number, holidays: readonly PublicHoliday[], fetchedAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.years.set(year, { _id: year, holidays: [...holidays], fetchedAt });
  }
}
