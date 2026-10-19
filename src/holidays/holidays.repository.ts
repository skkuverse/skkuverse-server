import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import { createCachedLoader } from "../infra/cached-loader";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { mongoCollection } from "../infra/mongo";
import type { PublicHolidaysDoc } from "./holidays.document";

const HOUR_MS = 60 * 60_000;
// WHY: a holiday the poller stores reaches every replica within ten minutes (ADR 0012, D6); a failed read
// keeps the last good years a day.
const STORED_YEARS_TTL_MS = 10 * 60_000;
const STORED_YEARS_STALE_WINDOW_MS = 24 * HOUR_MS;

@Injectable()
export class HolidaysRepository {
  private readonly storedYears = createCachedLoader({
    name: "holidays.public_holidays",
    ttlMs: STORED_YEARS_TTL_MS,
    staleWindowMs: STORED_YEARS_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: () =>
      this.publicHolidays()
        .find({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
        .toArray(),
  });

  listYears(): Promise<readonly PublicHolidaysDoc[]> {
    return this.storedYears.get();
  }

  clearCache(): void {
    this.storedYears.clear();
  }

  private publicHolidays(): Collection<PublicHolidaysDoc> {
    return mongoCollection<PublicHolidaysDoc>(config.mongo.dbName, config.holidays.collections.publicHolidays);
  }
}
