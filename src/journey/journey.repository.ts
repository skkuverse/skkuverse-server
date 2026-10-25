import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../shared/log-throttle.util";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { JOURNEY_LOG_INTERVAL_MS, JOURNEY_ROUTES_DATASET } from "./journey.constants";
import type { JourneyRoutesDatasetDoc, StoredJourneyRoutes } from "./journey.document";
import { JourneyRoutesReadError } from "./journey.error";
import { storedJourneyRoutes } from "./journey.schema";

@Injectable()
export class JourneyRepository {
  private readonly logThrottle = createLogThrottle(JOURNEY_LOG_INTERVAL_MS);

  async findRoutes(): Promise<StoredJourneyRoutes | null> {
    const doc = await this.datasets()
      .findOne({ _id: JOURNEY_ROUTES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new JourneyRoutesReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedJourneyRoutes.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "journey.routes_dataset.missing", dataset: JOURNEY_ROUTES_DATASET, ...taken }, "Journey routes dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "journey.routes_dataset.invalid", dataset: JOURNEY_ROUTES_DATASET, revision, issues, ...taken }, "Journey routes dataset fails its schema, not served");
    return null;
  }

  private datasets(): Collection<JourneyRoutesDatasetDoc> {
    return mongoCollection<JourneyRoutesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
