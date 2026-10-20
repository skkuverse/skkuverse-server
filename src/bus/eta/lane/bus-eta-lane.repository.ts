import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../../infra/db";
import { createLogThrottle } from "../../../infra/log-throttle";
import logger from "../../../infra/logger";
import { mongoCollection } from "../../../infra/mongo";
import { BUS_LANE_CORRIDOR_DATASET, BUS_LANE_CORRIDOR_LOG_INTERVAL_MS } from "./bus-eta-lane.constants";
import type { BusLaneCorridorDatasetDoc, StoredLaneCorridor } from "./bus-eta-lane.document";
import { BusEtaLaneReadError } from "./bus-eta-lane.error";
import { storedLaneCorridor } from "./bus-eta-lane.schema";

@Injectable()
export class BusEtaLaneRepository {
  private readonly logThrottle = createLogThrottle(BUS_LANE_CORRIDOR_LOG_INTERVAL_MS);

  async findCorridor(): Promise<StoredLaneCorridor | null> {
    const doc = await this.datasets()
      .findOne({ _id: BUS_LANE_CORRIDOR_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new BusEtaLaneReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedLaneCorridor.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "bus.lane_corridor.missing", dataset: BUS_LANE_CORRIDOR_DATASET, ...taken }, "Bus-lane corridor dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error({ event: "bus.lane_corridor.invalid", dataset: BUS_LANE_CORRIDOR_DATASET, revision, issues, ...taken }, "Bus-lane corridor dataset fails its schema, not used");
    return null;
  }

  private datasets(): Collection<BusLaneCorridorDatasetDoc> {
    return mongoCollection<BusLaneCorridorDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
