import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { JONGRO_ROUTE_ATTRIBUTES_DATASET, ROUTE_ATTRIBUTES_LOG_INTERVAL_MS } from "./bus-route-attributes.constants";
import type { JongroRouteAttributesDatasetDoc, StoredRouteAttributes } from "./bus-route-attributes.document";
import { BusRouteAttributesReadError } from "./bus-route-attributes.error";
import { storedRouteAttributes } from "./bus-route-attributes.schema";

@Injectable()
export class BusRouteAttributesRepository {
  private readonly logThrottle = createLogThrottle(ROUTE_ATTRIBUTES_LOG_INTERVAL_MS);

  async findAttributes(): Promise<StoredRouteAttributes | null> {
    const doc = await this.datasets()
      .findOne({ _id: JONGRO_ROUTE_ATTRIBUTES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusRouteAttributesReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedRouteAttributes.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "bus.route_attributes.missing", dataset: JONGRO_ROUTE_ATTRIBUTES_DATASET, ...taken }, "Jongro route attributes dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "bus.route_attributes.invalid", dataset: JONGRO_ROUTE_ATTRIBUTES_DATASET, revision, issues, ...taken },
      "Jongro route attributes dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<JongroRouteAttributesDatasetDoc> {
    return mongoCollection<JongroRouteAttributesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
