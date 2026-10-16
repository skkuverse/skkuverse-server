/**
 * In-memory HolidaysSyncRepository: upsertYear replaces the document of its
 * year in `years`, as the real upsert keyed by the year does (pinned in
 * holidays-sync.repository.spec.ts). `failWith` makes every write reject.
 */
import type { PublicHolidaysDoc } from "../../../../src/holidays/holidays.document";
import type { PublicHoliday } from "../../../../src/holidays/holidays.types";
import type { HolidaysSyncRepository } from "../../../../src/holidays/sync/holidays-sync.repository";
import type { PublicOf } from "../public-of";

export class FakeHolidaysSyncRepository implements PublicOf<HolidaysSyncRepository> {
  years = new Map<number, PublicHolidaysDoc>();
  failWith: Error | null = null;

  async upsertYear(year: number, holidays: readonly PublicHoliday[], fetchedAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.years.set(year, { _id: year, holidays: [...holidays], fetchedAt });
  }
}
