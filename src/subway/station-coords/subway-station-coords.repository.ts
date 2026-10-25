import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import type { z } from "zod";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { STATION_COORDS_LOG_INTERVAL_MS, SUBWAY_STATION_COORDS_DATASET } from "./subway-station-coords.constants";
import type { StoredStationCoords, SubwayStationCoordsDatasetDoc } from "./subway-station-coords.document";
import { SubwayStationCoordsReadError } from "./subway-station-coords.error";
import { storedStationCoords } from "./subway-station-coords.schema";

@Injectable()
export class SubwayStationCoordsRepository {
  private readonly logThrottle = createLogThrottle(STATION_COORDS_LOG_INTERVAL_MS);

  async findCoords(): Promise<StoredStationCoords | null> {
    const doc = await this.datasets()
      .findOne({ _id: SUBWAY_STATION_COORDS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new SubwayStationCoordsReadError(err);
      });
    if (doc === null) return this.reportMissing();
    const parsed = storedStationCoords.safeParse(doc);
    return parsed.success ? parsed.data : this.reportInvalid(doc.revision, parsed.error);
  }

  private reportMissing(): null {
    const taken = this.logThrottle.take("missing");
    if (taken) logger.error({ event: "subway.station_coords.missing", dataset: SUBWAY_STATION_COORDS_DATASET, ...taken }, "Subway station coords dataset not found");
    return null;
  }

  private reportInvalid(revision: unknown, error: z.ZodError): null {
    const taken = this.logThrottle.take(`invalid:${String(revision)}`);
    if (!taken) return null;
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "subway.station_coords.invalid", dataset: SUBWAY_STATION_COORDS_DATASET, revision, issues, ...taken },
      "Subway station coords dataset fails its schema, not served",
    );
    return null;
  }

  private datasets(): Collection<SubwayStationCoordsDatasetDoc> {
    return mongoCollection<SubwayStationCoordsDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
