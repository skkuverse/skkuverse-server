import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { BUS_STOPS_DATASET, BUS_STOPS_LOG_INTERVAL_MS } from "./bus-stops.constants";
import type { BusStopsDatasetDoc, StoredBusStops } from "./bus-stops.document";
import { BusStopsReadError } from "./bus-stops.error";
import { storedBusStops } from "./bus-stops.schema";

@Injectable()
export class BusStopsRepository {
  private readonly logThrottle = createLogThrottle(BUS_STOPS_LOG_INTERVAL_MS);

  async findStops(): Promise<StoredBusStops | null> {
    const doc = await this.datasets()
      .findOne({ _id: BUS_STOPS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusStopsReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedBusStops.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "bus.stops.missing", dataset: BUS_STOPS_DATASET, ...taken }, "Bus stops dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "bus.stops.invalid", dataset: BUS_STOPS_DATASET, revision, issues, ...taken }, "Bus stops dataset fails its schema, not served");
    return null;
  }

  private datasets(): Collection<BusStopsDatasetDoc> {
    return mongoCollection<BusStopsDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
