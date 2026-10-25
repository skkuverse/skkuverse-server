import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { CAMPUS_BANNERS_DATASET, CAMPUS_BANNERS_LOG_INTERVAL_MS } from "./ui-campus.constants";
import type { CampusBannersDatasetDoc } from "./ui-campus.document";
import { UiCampusBannersReadError } from "./ui-campus.error";
import { storedCampusBanners } from "./ui-campus.schema";
import type { CampusBannersRevision } from "./ui-campus.types";

@Injectable()
export class UiCampusRepository {
  private readonly logThrottle = createLogThrottle(CAMPUS_BANNERS_LOG_INTERVAL_MS);

  async findCampusBanners(): Promise<CampusBannersRevision | null> {
    const doc = await this.datasets()
      .findOne({ _id: CAMPUS_BANNERS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new UiCampusBannersReadError(err);
      });
    if (doc === null) {
      const taken = this.logThrottle.take("missing");
      if (taken) logger.error({ event: "ui.campus_banners.missing", dataset: CAMPUS_BANNERS_DATASET, ...taken }, "Campus banners dataset not found");
      return null;
    }
    const parsed = storedCampusBanners.safeParse(doc);
    if (parsed.success) return { revision: parsed.data.revision, banners: parsed.data.data };
    const taken = this.logThrottle.take(`invalid:${String(doc.revision)}`);
    if (!taken) return null;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "ui.campus_banners.invalid", dataset: CAMPUS_BANNERS_DATASET, revision: doc.revision, issues, ...taken },
      "Campus banners dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<CampusBannersDatasetDoc> {
    return mongoCollection<CampusBannersDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
