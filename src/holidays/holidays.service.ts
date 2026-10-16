import { Injectable } from "@nestjs/common";
import { createCachedLoader, type CachedLoader } from "../infra/cached-loader";
import { Clock } from "../infra/clock";
import { createLogThrottle, type LogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { lookupKoreanPublicHoliday, toHolidayYear } from "../shared/korean-public-holiday.util";
import { HolidaysClient } from "./holidays.client";
import { HolidaysRepository } from "./holidays.repository";
import { toSyncYears } from "./holidays.rules";

const HOUR_MS = 60 * 60_000;
// WHY: api replicas read the stored years at most once an hour; a failed read keeps the last good years a day.
const STORED_YEARS_TTL_MS = HOUR_MS;
const STORED_YEARS_STALE_WINDOW_MS = 24 * HOUR_MS;

type HolidayNameByDate = ReadonlyMap<string, string>;

// SEE: docs/decisions/0010-server-architecture.md (D1): the door for other features, which import only a
// .module or a .service.
@Injectable()
export class HolidaysService {
  private readonly storedYears: CachedLoader<ReadonlyMap<number, HolidayNameByDate>>;
  private readonly rulesFallbackThrottle: LogThrottle;

  constructor(
    private readonly client: HolidaysClient,
    private readonly repository: HolidaysRepository,
    private readonly clock: Clock,
  ) {
    this.storedYears = createCachedLoader({
      name: "holidays.public_holidays",
      ttlMs: STORED_YEARS_TTL_MS,
      staleWindowMs: STORED_YEARS_STALE_WINDOW_MS,
      load: () => this.loadStoredYears(),
    });
    this.rulesFallbackThrottle = createLogThrottle(HOUR_MS, () => this.clock.now().getTime());
  }

  async holidayName(dateStr: string): Promise<string | null> {
    const year = toHolidayYear(dateStr);
    const calendar = (await this.storedYears.get()).get(year);
    if (calendar) return calendar.get(dateStr) ?? null;
    const ticket = this.rulesFallbackThrottle.take(String(year));
    if (ticket) {
      logger.warn(
        { event: "holidays.lookup.rules_fallback", year, suppressed: ticket.suppressed },
        "No stored calendar for the year, answering holidays from rules",
      );
    }
    return lookupKoreanPublicHoliday(dateStr);
  }

  // WHY: logs no failure itself; the poller registry reports the rejection. One year failing still stores
  // the other, and a year with no rows is not published yet, so it keeps what answers it now.
  async sync(): Promise<void> {
    const fetchedAt = this.clock.now();
    const failures: unknown[] = [];
    for (const year of toSyncYears(fetchedAt)) {
      try {
        await this.syncYear(year, fetchedAt);
      } catch (err) {
        failures.push(err);
      }
    }
    this.storedYears.clear();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Holiday calendar sync failed for every year");
  }

  private async syncYear(year: number, fetchedAt: Date): Promise<void> {
    const holidays = await this.client.fetchYear(year);
    if (holidays.length === 0) {
      logger.info({ event: "holidays.sync.year_unpublished", year }, "Holiday calendar lists no days for the year yet");
      return;
    }
    await this.repository.upsertYear(year, holidays, fetchedAt);
    logger.info({ event: "holidays.sync.year_stored", year, holidays: holidays.length }, "Holiday calendar year stored");
  }

  private async loadStoredYears(): Promise<ReadonlyMap<number, HolidayNameByDate>> {
    const years = await this.repository.listYears();
    return new Map(years.map((doc) => [doc._id, new Map(doc.holidays.map((holiday) => [holiday.date, holiday.name]))]));
  }
}
