import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import { createCachedLoader } from "../infra/cached-loader";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { REST_DAYS_LOG_INTERVAL_MS, SKKU_REST_DAYS_DATASET } from "./calendar.constants";
import type { PublicHolidaysDoc, SkkuRestDaysDatasetDoc } from "./calendar.document";
import { CalendarReadError } from "./calendar.error";
import { storedRestDays } from "./calendar.schema";
import type { RestDaysRevision } from "./calendar.types";

const HOUR_MS = 60 * 60_000;
// WHY: a holiday the poller stores reaches every replica within ten minutes (ADR 0012, D6); a failed read
// keeps the last good years a day.
const STORED_YEARS_TTL_MS = 10 * 60_000;
const STORED_YEARS_STALE_WINDOW_MS = 24 * HOUR_MS;

@Injectable()
export class CalendarRepository {
  private readonly restDaysLogThrottle = createLogThrottle(REST_DAYS_LOG_INTERVAL_MS);
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

  listPublicHolidayYears(): Promise<readonly PublicHolidaysDoc[]> {
    return this.storedYears.get();
  }

  clearPublicHolidaysCache(): void {
    this.storedYears.clear();
  }

  async findRestDays(): Promise<RestDaysRevision | null> {
    const doc = await this.restDays()
      .findOne({ _id: SKKU_REST_DAYS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new CalendarReadError(SKKU_REST_DAYS_DATASET, err);
      });
    if (doc === null) return this.reportMissingRestDays();
    const parsed = storedRestDays.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, restDays: parsed.data.data };
    return this.reportInvalidRestDays(doc.revision, parsed.error);
  }

  private reportMissingRestDays(): null {
    const taken = this.restDaysLogThrottle.take("missing");
    if (taken) logger.error({ event: "calendar.rest_days.missing", dataset: SKKU_REST_DAYS_DATASET, ...taken }, "School rest days dataset not found");
    return null;
  }

  private reportInvalidRestDays(revision: unknown, error: z.ZodError): null {
    const taken = this.restDaysLogThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "calendar.rest_days.invalid", dataset: SKKU_REST_DAYS_DATASET, revision, issues, ...taken },
      "School rest days dataset fails its schema, not served",
    );
    return null;
  }

  private publicHolidays(): Collection<PublicHolidaysDoc> {
    return mongoCollection<PublicHolidaysDoc>(config.mongo.dbName, config.holidays.collections.publicHolidays);
  }

  private restDays(): Collection<SkkuRestDaysDatasetDoc> {
    return mongoCollection<SkkuRestDaysDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
