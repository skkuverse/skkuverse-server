import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS, BUS_SERVICE_NOTICES_DATASET, SKKU_REST_DAYS_DATASET } from "./bus-schedule-content.constants";
import type { BusServiceNoticesDatasetDoc, SkkuRestDaysDatasetDoc } from "./bus-schedule-content.document";
import { BusScheduleContentReadError } from "./bus-schedule-content.error";
import { storedRestDays, storedServiceNotices } from "./bus-schedule-content.schema";
import type { DatasetLogEvents, RestDaysRevision, ServiceNoticesRevision } from "./bus-schedule-content.types";

const SERVICE_NOTICES_EVENTS: DatasetLogEvents = {
  dataset: BUS_SERVICE_NOTICES_DATASET,
  missing: "bus.service_notices.missing",
  invalid: "bus.service_notices.invalid",
};

const REST_DAYS_EVENTS: DatasetLogEvents = {
  dataset: SKKU_REST_DAYS_DATASET,
  missing: "bus.rest_days.missing",
  invalid: "bus.rest_days.invalid",
};

@Injectable()
export class BusScheduleContentRepository {
  private readonly logThrottle = createLogThrottle(BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS);

  async findServiceNotices(): Promise<ServiceNoticesRevision | null> {
    const doc = await this.serviceNotices()
      .findOne({ _id: BUS_SERVICE_NOTICES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusScheduleContentReadError(BUS_SERVICE_NOTICES_DATASET, err);
      });
    if (doc === null) return this.reportMissing(SERVICE_NOTICES_EVENTS);
    const parsed = storedServiceNotices.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, services: parsed.data.data.services };
    return this.reportInvalid(SERVICE_NOTICES_EVENTS, doc.revision, parsed.error);
  }

  async findRestDays(): Promise<RestDaysRevision | null> {
    const doc = await this.restDays()
      .findOne({ _id: SKKU_REST_DAYS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusScheduleContentReadError(SKKU_REST_DAYS_DATASET, err);
      });
    if (doc === null) return this.reportMissing(REST_DAYS_EVENTS);
    const parsed = storedRestDays.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, restDays: parsed.data.data };
    return this.reportInvalid(REST_DAYS_EVENTS, doc.revision, parsed.error);
  }

  private reportMissing({ dataset, missing }: DatasetLogEvents): null {
    const taken = this.logThrottle.take(`${dataset}:missing`);
    if (taken) logger.error({ event: missing, dataset, ...taken }, "Bus schedule content dataset not found");
    return null;
  }

  private reportInvalid({ dataset, invalid }: DatasetLogEvents, revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`${dataset}:invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: invalid, dataset, revision, issues, ...taken }, "Bus schedule content dataset fails its schema, not served");
    return null;
  }

  private serviceNotices(): Collection<BusServiceNoticesDatasetDoc> {
    return mongoCollection<BusServiceNoticesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }

  private restDays(): Collection<SkkuRestDaysDatasetDoc> {
    return mongoCollection<SkkuRestDaysDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
