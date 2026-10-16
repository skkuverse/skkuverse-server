import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { HolidaysRepository } from "../holidays.repository";
import { HolidaysSyncClient } from "./holidays-sync.client";
import { HolidaysSyncRepository } from "./holidays-sync.repository";
import { toSyncYears } from "./holidays-sync.rules";

@Injectable()
export class HolidaysSyncService {
  constructor(
    private readonly client: HolidaysSyncClient,
    private readonly repository: HolidaysSyncRepository,
    private readonly holidays: HolidaysRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: logs no failure itself; the poller registry reports the rejection. One year failing still stores
  // the other, and a year with no rows is not published yet, so it keeps what answers it now.
  async run(): Promise<void> {
    const fetchedAt = this.clock.now();
    const failures: unknown[] = [];
    for (const year of toSyncYears(fetchedAt)) {
      try {
        await this.syncYear(year, fetchedAt);
      } catch (err) {
        failures.push(err);
      }
    }
    this.holidays.clearCache();
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
}
