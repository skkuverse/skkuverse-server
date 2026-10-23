/**
 * In-memory CalendarRepository.
 *
 * `years` holds one `public_holidays` document per year, keyed by the year as
 * the sync's upsert keys it, and listPublicHolidayYears returns them all as the
 * real read does (pinned in calendar.repository.spec.ts). It does not cache:
 * `reads` counts the reads and `clears` the clearPublicHolidaysCache() calls;
 * `failWith` makes every read of the public holidays reject.
 *
 * `storeRestDays` stores the `skku-rest-days` dataset unchecked at the next
 * revision, as `npm run data` would without its checks, so a test can seed an
 * invalid one, and findRestDays reads it as the real read does: the revision
 * and data only, parsed with the same schema, so a missing or invalid document
 * reads as `null`. `failRestDaysWith` makes the next reads reject, wrapped in
 * CalendarReadError as the real read wraps a driver error; `restDaysReadCount`
 * counts the reads that reached the store.
 *
 * `storeAcademicYear` stores one `academic_calendars` document as the crawler
 * would, unchecked and replacing the one with its `_id`, and
 * listAcademicYears reads them as the real read does: the projected fields
 * only, each parsed with the same schema, an invalid one left out. It does
 * not cache: `academicReadCount` counts the reads, and `failAcademicWith`
 * makes each read reject, as the real read rejects once it holds no good
 * value inside its stale window.
 */
import { CalendarReadError } from "../../../../src/calendar/calendar.error";
import type { AcademicCalendarDoc, PublicHolidaysDoc } from "../../../../src/calendar/calendar.document";
import type { CalendarRepository } from "../../../../src/calendar/calendar.repository";
import { academicCalendarDoc, storedRestDays } from "../../../../src/calendar/calendar.schema";
import type { PublicHoliday, RestDaysRevision } from "../../../../src/calendar/calendar.types";
import type { PublicOf } from "../public-of";

const SKKU_REST_DAYS = "skku-rest-days";

export class FakeCalendarRepository implements PublicOf<CalendarRepository> {
  years = new Map<number, PublicHolidaysDoc>();
  reads = 0;
  clears = 0;
  failWith: Error | null = null;
  restDaysDataset: { revision: unknown; data: unknown } | null = null;
  failRestDaysWith: Error | null = null;
  restDaysReadCount = 0;
  academicCalendars = new Map<string, Record<string, unknown>>();
  failAcademicWith: Error | null = null;
  academicReadCount = 0;

  /** Stores `holidays` as the synced document of `year`. */
  store(year: number, holidays: PublicHoliday[], fetchedAt = new Date("2026-10-16T00:00:00Z")): this {
    this.years.set(year, { _id: year, holidays, fetchedAt });
    return this;
  }

  async listPublicHolidayYears(): Promise<readonly PublicHolidaysDoc[]> {
    this.reads += 1;
    if (this.failWith) throw this.failWith;
    return [...this.years.values()].map((doc) => ({ ...doc, holidays: [...doc.holidays] }));
  }

  clearPublicHolidaysCache(): void {
    this.clears += 1;
  }

  /** Stores `data` as the next revision of `skku-rest-days`, unchecked, and returns that revision. */
  storeRestDays(data: unknown): number {
    const current = this.restDaysDataset?.revision;
    const revision = typeof current === "number" ? current + 1 : 1;
    this.restDaysDataset = { revision, data: structuredClone(data) };
    return revision;
  }

  async findRestDays(): Promise<RestDaysRevision | null> {
    if (this.failRestDaysWith) throw new CalendarReadError(SKKU_REST_DAYS, this.failRestDaysWith);
    this.restDaysReadCount += 1;
    if (this.restDaysDataset === null) return null;
    const parsed = storedRestDays.safeParse(structuredClone(this.restDaysDataset));
    return parsed.success ? { revision: parsed.data.revision, restDays: parsed.data.data } : null;
  }

  /** Stores `doc` in `academic_calendars` under its `_id`, unchecked, as the crawler's upsert would. */
  storeAcademicYear(doc: Record<string, unknown>): this {
    this.academicCalendars.set(String(doc._id), structuredClone(doc));
    return this;
  }

  async listAcademicYears(): Promise<readonly AcademicCalendarDoc[]> {
    this.academicReadCount += 1;
    if (this.failAcademicWith) throw this.failAcademicWith;
    return [...this.academicCalendars.values()].flatMap((doc) => {
      const { _id, year, contentHash, semesters, restDays } = structuredClone(doc);
      const parsed = academicCalendarDoc.safeParse({ _id, year, contentHash, semesters, restDays });
      return parsed.success ? [parsed.data] : [];
    });
  }
}
