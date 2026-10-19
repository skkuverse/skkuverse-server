import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS, BUS_SERVICE_NOTICES_DATASET } from "./bus-schedule-content.constants";
import type { BusServiceNoticesDatasetDoc } from "./bus-schedule-content.document";
import { BusScheduleContentReadError } from "./bus-schedule-content.error";
import { storedServiceNotices } from "./bus-schedule-content.schema";
import type { DatasetLogEvents, ServiceNoticesRevision } from "./bus-schedule-content.types";

const SERVICE_NOTICES_EVENTS: DatasetLogEvents = {
  dataset: BUS_SERVICE_NOTICES_DATASET,
  missing: "bus.service_notices.missing",
  invalid: "bus.service_notices.invalid",
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
}
