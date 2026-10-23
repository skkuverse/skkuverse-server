import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { APP_FEATURES_DATASET, APP_FEATURES_LOG_INTERVAL_MS } from "./app-config.constants";
import type { AppFeaturesDatasetDoc, StoredAppFeatures } from "./app-config.document";
import { AppConfigFeaturesReadError } from "./app-config.error";
import { storedAppFeatures } from "./app-config.schema";

@Injectable()
export class AppConfigRepository {
  private readonly logThrottle = createLogThrottle(APP_FEATURES_LOG_INTERVAL_MS);

  async findFeatures(): Promise<StoredAppFeatures | null> {
    const doc = await this.datasets()
      .findOne({ _id: APP_FEATURES_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new AppConfigFeaturesReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedAppFeatures.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "app_config.features.missing", dataset: APP_FEATURES_DATASET, ...taken }, "App features dataset not found; served off");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "app_config.features.invalid", dataset: APP_FEATURES_DATASET, revision, issues, ...taken },
      "App features dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<AppFeaturesDatasetDoc> {
    return mongoCollection<AppFeaturesDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
