import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { HOME_LAYOUT_DATASET } from "./ui-home.constants";
import type { HomeLayoutDatasetDoc } from "./ui-home.document";
import { storedHomeLayout } from "./ui-home.schema";
import type { HomeLayoutRevision } from "./ui-home.types";

@Injectable()
export class UiHomeRepository {
  async findHomeLayout(): Promise<HomeLayoutRevision | null> {
    const doc = await this.datasets().findOne(
      { _id: HOME_LAYOUT_DATASET },
      { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
    if (doc === null) {
      logger.error({ event: "ui.home_layout.missing", dataset: HOME_LAYOUT_DATASET }, "Home layout dataset not found");
      return null;
    }
    const parsed = storedHomeLayout.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, layout: parsed.data.data };
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "ui.home_layout.invalid", dataset: HOME_LAYOUT_DATASET, revision: doc.revision, issues }, "Home layout dataset fails its schema, not served");
    return null;
  }

  private datasets(): Collection<HomeLayoutDatasetDoc> {
    return mongoCollection<HomeLayoutDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
