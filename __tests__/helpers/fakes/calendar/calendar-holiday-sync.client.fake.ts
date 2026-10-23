/**
 * CalendarHolidaySyncClient with scripted answers, already in the shape the real client
 * translates getRestDeInfo into (calendar-holiday-sync.client.spec.ts covers that). A year
 * with no entry answers no holidays, as an unpublished year does; an Error in
 * its place rejects. `calls` records every year asked for, in order.
 */
import type { CalendarHolidaySyncClient } from "../../../../src/calendar/holiday-sync/calendar-holiday-sync.client";
import type { PublicHoliday } from "../../../../src/calendar/calendar.types";
import type { PublicOf } from "../public-of";

export class FakeCalendarHolidaySyncClient implements PublicOf<CalendarHolidaySyncClient> {
  answers = new Map<number, PublicHoliday[] | Error>();
  calls: number[] = [];

  async fetchYear(year: number): Promise<PublicHoliday[]> {
    this.calls.push(year);
    const answer = this.answers.get(year) ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  }
}
