import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { mongoCollection } from "../infra/mongo";
import { MINIAPPS_DATASET, REGISTRY_LOG_INTERVAL_MS } from "./miniapps.constants";
import type { MiniAppsDatasetDoc } from "./miniapps.document";
import { MiniappsRegistryReadError } from "./miniapps.error";
import { storedRegistry } from "./miniapps.schema";
import type { MiniAppsRegistryRevision } from "./miniapps.types";

@Injectable()
export class MiniappsRepository {
  private readonly logThrottle = createLogThrottle(REGISTRY_LOG_INTERVAL_MS);

  async findRegistry(): Promise<MiniAppsRegistryRevision | null> {
    const doc = await this.datasets()
      .findOne({ _id: MINIAPPS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new MiniappsRegistryReadError(err);
      });
    if (doc === null) {
      const taken = this.logThrottle.take("missing");
      if (taken) logger.error({ event: "miniapps.registry.missing", dataset: MINIAPPS_DATASET, ...taken }, "Mini app registry dataset not found");
      return null;
    }
    const parsed = storedRegistry.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, registry: parsed.data.data };
    const taken = this.logThrottle.take(`invalid:${String(doc.revision)}`);
    if (!taken) return null;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "miniapps.registry.invalid", dataset: MINIAPPS_DATASET, revision: doc.revision, issues, ...taken },
      "Mini app registry dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<MiniAppsDatasetDoc> {
    return mongoCollection<MiniAppsDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
