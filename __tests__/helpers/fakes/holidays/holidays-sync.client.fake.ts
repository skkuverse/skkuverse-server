/**
 * HolidaysSyncClient with scripted answers, already in the shape the real client
 * translates getRestDeInfo into (holidays-sync.client.spec.ts covers that). A year
 * with no entry answers no holidays, as an unpublished year does; an Error in
 * its place rejects. `calls` records every year asked for, in order.
 */
import type { HolidaysSyncClient } from "../../../../src/holidays/sync/holidays-sync.client";
import type { PublicHoliday } from "../../../../src/holidays/holidays.types";
import type { PublicOf } from "../public-of";

export class FakeHolidaysSyncClient implements PublicOf<HolidaysSyncClient> {
  answers = new Map<number, PublicHoliday[] | Error>();
  calls: number[] = [];

  async fetchYear(year: number): Promise<PublicHoliday[]> {
    this.calls.push(year);
    const answer = this.answers.get(year) ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  }
}
