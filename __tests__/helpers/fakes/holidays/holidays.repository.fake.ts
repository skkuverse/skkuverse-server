/**
 * In-memory HolidaysRepository: `years` holds one document per year, keyed by
 * the year as the sync's upsert keys it, and listYears returns them all as the
 * real read does (pinned in holidays.repository.spec.ts). It does not cache:
 * `reads` counts the reads and `clears` the clearCache() calls; `failWith`
 * makes every read reject.
 */
import type { PublicHolidaysDoc } from "../../../../src/holidays/holidays.document";
import type { HolidaysRepository } from "../../../../src/holidays/holidays.repository";
import type { PublicHoliday } from "../../../../src/holidays/holidays.types";
import type { PublicOf } from "../public-of";

export class FakeHolidaysRepository implements PublicOf<HolidaysRepository> {
  years = new Map<number, PublicHolidaysDoc>();
  reads = 0;
  clears = 0;
  failWith: Error | null = null;

  /** Stores `holidays` as the synced document of `year`. */
  store(year: number, holidays: PublicHoliday[], fetchedAt = new Date("2026-10-16T00:00:00Z")): this {
    this.years.set(year, { _id: year, holidays, fetchedAt });
    return this;
  }

  async listYears(): Promise<readonly PublicHolidaysDoc[]> {
    this.reads += 1;
    if (this.failWith) throw this.failWith;
    return [...this.years.values()].map((doc) => ({ ...doc, holidays: [...doc.holidays] }));
  }

  clearCache(): void {
    this.clears += 1;
  }
}
