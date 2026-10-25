import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { HSSC_ROUTE_LINE_DATASET, HSSC_ROUTE_LINE_LOG_INTERVAL_MS } from "./bus-hssc-route-line.constants";
import type { HsscRouteLineDatasetDoc, StoredHsscRouteLine } from "./bus-hssc-route-line.document";
import { BusHsscRouteLineReadError } from "./bus-hssc-route-line.error";
import { storedHsscRouteLine } from "./bus-hssc-route-line.schema";

@Injectable()
export class BusHsscRouteLineRepository {
  private readonly logThrottle = createLogThrottle(HSSC_ROUTE_LINE_LOG_INTERVAL_MS);

  async findRouteLine(): Promise<StoredHsscRouteLine | null> {
    const doc = await this.datasets()
      .findOne({ _id: HSSC_ROUTE_LINE_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusHsscRouteLineReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedHsscRouteLine.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "bus.hssc_route_line.missing", dataset: HSSC_ROUTE_LINE_DATASET, ...taken }, "HSSC route line dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "bus.hssc_route_line.invalid", dataset: HSSC_ROUTE_LINE_DATASET, revision, issues, ...taken }, "HSSC route line dataset fails its schema, not served");
    return null;
  }

  private datasets(): Collection<HsscRouteLineDatasetDoc> {
    return mongoCollection<HsscRouteLineDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
