import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { SUBWAY_TOPOLOGY_DATASET, TOPOLOGY_LOG_INTERVAL_MS } from "./subway-topology.constants";
import type { SubwayTopologyDatasetDoc, StoredSubwayTopology } from "./subway-topology.document";
import { SubwayTopologyReadError } from "./subway-topology.error";
import { storedSubwayTopology } from "./subway-topology.schema";

@Injectable()
export class SubwayTopologyRepository {
  private readonly logThrottle = createLogThrottle(TOPOLOGY_LOG_INTERVAL_MS);

  async findTopology(): Promise<StoredSubwayTopology | null> {
    const doc = await this.datasets()
      .findOne({ _id: SUBWAY_TOPOLOGY_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new SubwayTopologyReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedSubwayTopology.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "subway.topology.missing", dataset: SUBWAY_TOPOLOGY_DATASET, ...taken }, "Subway topology dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "subway.topology.invalid", dataset: SUBWAY_TOPOLOGY_DATASET, revision, issues, ...taken },
      "Subway topology dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<SubwayTopologyDatasetDoc> {
    return mongoCollection<SubwayTopologyDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
