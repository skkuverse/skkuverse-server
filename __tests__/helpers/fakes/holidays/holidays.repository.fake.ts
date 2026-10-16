/**
 * (A credential detail is left out of the public history.)
 */
import type { PublicHolidaysDoc } from "../../../../src/holidays/holidays.document";
import type { HolidaysRepository } from "../../../../src/holidays/holidays.repository";
import type { PublicHoliday } from "../../../../src/holidays/holidays.types";
import type { PublicOf } from "../public-of";

export class FakeHolidaysRepository implements PublicOf<HolidaysRepository> {
  years = new Map<number, PublicHolidaysDoc>();
  reads = 0;
  failWith: Error | null = null;

  /** Stores `holidays` as the synced document of `year`. */
  store(year: number, holidays: PublicHoliday[], fetchedAt = new Date("2026-10-16T00:00:00Z")): this {
    this.years.set(year, { _id: year, holidays, fetchedAt });
    return this;
  }

  async listYears(): Promise<PublicHolidaysDoc[]> {
    this.reads += 1;
    if (this.failWith) throw this.failWith;
    return [...this.years.values()].map((doc) => ({ ...doc, holidays: [...doc.holidays] }));
  }

  async upsertYear(year: number, holidays: readonly PublicHoliday[], fetchedAt: Date): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.years.set(year, { _id: year, holidays: [...holidays], fetchedAt });
  }
}
