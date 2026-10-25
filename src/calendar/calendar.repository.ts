import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import { createCachedLoader } from "../infra/cached-loader";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../shared/log-throttle.util";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { parseEach } from "../shared/zod-list.util";
import { REST_DAYS_LOG_INTERVAL_MS, SKKU_REST_DAYS_DATASET } from "./calendar.constants";
import type { AcademicCalendarDoc, PublicHolidaysDoc, SkkuRestDaysDatasetDoc } from "./calendar.document";
import { CalendarReadError } from "./calendar.error";
import { academicCalendarDoc, publicHolidaysDoc, storedRestDays } from "./calendar.schema";
import type { RestDaysRevision } from "./calendar.types";

const HOUR_MS = 60 * 60_000;
// WHY: a holiday the crawler stores reaches every replica within ten minutes (ADR 0012, D6); a failed read
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
    load: () => this.readPublicHolidayYears(),
  });
  // WHY: the crawler writes once a day; the stored years' bound and stale window serve it too.
  private readonly academicYears = createCachedLoader({
    name: "calendar.academic_calendars",
    ttlMs: STORED_YEARS_TTL_MS,
    staleWindowMs: STORED_YEARS_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: () => this.readAcademicYears(),
  });

  listPublicHolidayYears(): Promise<readonly PublicHolidaysDoc[]> {
    return this.storedYears.get();
  }

  listAcademicYears(): Promise<readonly AcademicCalendarDoc[]> {
    return this.academicYears.get();
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

  private async readPublicHolidayYears(): Promise<PublicHolidaysDoc[]> {
    const docs = await this.publicHolidays()
      .find({}, { projection: { _id: 1, holidays: 1, fetchedAt: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const { valid, invalid } = parseEach(docs, publicHolidaysDoc, (doc, index) => this.keyOf(doc, index));
    if (invalid.length > 0) {
      logger.error({ event: "calendar.public_holidays.invalid_document", invalid }, "Public holiday years left out, their dates answered by the rule");
    }
    return valid;
  }

  private async readAcademicYears(): Promise<AcademicCalendarDoc[]> {
    const docs = await this.academicCalendars()
      .find({}, { projection: { _id: 1, year: 1, contentHash: 1, semesters: 1, restDays: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const { valid, invalid } = parseEach(docs, academicCalendarDoc, (doc, index) => this.keyOf(doc, index));
    if (invalid.length > 0) {
      logger.error({ event: "academic_calendar.invalid_document", invalid }, "Academic calendar documents left out, their years answered by the rule");
    }
    return valid;
  }

  private keyOf(doc: unknown, index: number): string {
    return typeof doc === "object" && doc !== null && "_id" in doc ? String(doc._id) : `#${index}`;
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

  private academicCalendars(): Collection<AcademicCalendarDoc> {
    return mongoCollection<AcademicCalendarDoc>(config.notices.dbName, config.calendar.collections.academicCalendars);
  }

  private restDays(): Collection<SkkuRestDaysDatasetDoc> {
    return mongoCollection<SkkuRestDaysDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
