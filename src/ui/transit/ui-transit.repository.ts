import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { TRANSIT_LAYOUT_DATASET, TRANSIT_LAYOUT_LOG_INTERVAL_MS } from "./ui-transit.constants";
import type { TransitLayoutDatasetDoc } from "./ui-transit.document";
import { UiTransitLayoutReadError } from "./ui-transit.error";
import { storedTransitLayout } from "./ui-transit.schema";
import type { TransitLayoutRevision } from "./ui-transit.types";

@Injectable()
export class UiTransitRepository {
  private readonly logThrottle = createLogThrottle(TRANSIT_LAYOUT_LOG_INTERVAL_MS);

  async findTransitLayout(): Promise<TransitLayoutRevision | null> {
    const doc = await this.datasets()
      .findOne({ _id: TRANSIT_LAYOUT_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new UiTransitLayoutReadError(err);
      });
    if (doc === null) {
      const taken = this.logThrottle.take("missing");
      if (taken) logger.error({ event: "ui.transit_layout.missing", dataset: TRANSIT_LAYOUT_DATASET, ...taken }, "Transit layout dataset not found");
      return null;
    }
    const parsed = storedTransitLayout.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, layout: parsed.data.data };
    const taken = this.logThrottle.take(`invalid:${String(doc.revision)}`);
    if (!taken) return null;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "ui.transit_layout.invalid", dataset: TRANSIT_LAYOUT_DATASET, revision: doc.revision, issues, ...taken },
      "Transit layout dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<TransitLayoutDatasetDoc> {
    return mongoCollection<TransitLayoutDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
