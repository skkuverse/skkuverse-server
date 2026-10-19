import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { HOME_LAYOUT_DATASET, HOME_LAYOUT_LOG_INTERVAL_MS } from "./ui-home.constants";
import type { HomeLayoutDatasetDoc } from "./ui-home.document";
import { UiHomeLayoutReadError } from "./ui-home.error";
import { storedHomeLayout } from "./ui-home.schema";
import type { HomeLayoutRevision } from "./ui-home.types";

@Injectable()
export class UiHomeRepository {
  private readonly logThrottle = createLogThrottle(HOME_LAYOUT_LOG_INTERVAL_MS);

  async findHomeLayout(): Promise<HomeLayoutRevision | null> {
    const doc = await this.datasets()
      .findOne({ _id: HOME_LAYOUT_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new UiHomeLayoutReadError(err);
      });
    if (doc === null) {
      const taken = this.logThrottle.take("missing");
      if (taken) logger.error({ event: "ui.home_layout.missing", dataset: HOME_LAYOUT_DATASET, ...taken }, "Home layout dataset not found");
      return null;
    }
    const parsed = storedHomeLayout.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, layout: parsed.data.data };
    const taken = this.logThrottle.take(`invalid:${String(doc.revision)}`);
    if (!taken) return null;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "ui.home_layout.invalid", dataset: HOME_LAYOUT_DATASET, revision: doc.revision, issues, ...taken },
      "Home layout dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<HomeLayoutDatasetDoc> {
    return mongoCollection<HomeLayoutDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
