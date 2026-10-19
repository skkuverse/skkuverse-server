import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { MAP_LAYER_SETS_DATASET, MAP_LAYER_SETS_LOG_INTERVAL_MS } from "./map-layer-set.constants";
import type { MapLayerSetsDatasetDoc } from "./map-layer-set.document";
import { MapLayerSetsReadError } from "./map-layer-set.error";
import { storedLayerSets } from "./map-layer-set.schema";
import type { MapLayerSetsRevision, RejectedLayerSet } from "./map-layer-set.types";

@Injectable()
export class MapLayerSetRepository {
  private readonly logThrottle = createLogThrottle(MAP_LAYER_SETS_LOG_INTERVAL_MS);
  // WHY: every reload of one revision re-finds the same bad sets; each is logged once per revision this process reads.
  private loggedRevision: number | null = null;

  async findLayerSets(): Promise<MapLayerSetsRevision | null> {
    const doc = await this.datasets()
      .findOne({ _id: MAP_LAYER_SETS_DATASET }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .catch((err: unknown) => {
        throw new MapLayerSetsReadError(err);
      });
    if (doc === null) {
      const taken = this.logThrottle.take("missing");
      if (taken) logger.error({ event: "map.layer_sets.missing", dataset: MAP_LAYER_SETS_DATASET, ...taken }, "Map layer sets dataset not found");
      return null;
    }
    const parsed = storedLayerSets.safeParse(doc);
    if (parsed.success) {
      this.logRejected(parsed.data.revision, parsed.data.data.rejected);
      return { revision: parsed.data.revision, ...parsed.data.data };
    }
    const taken = this.logThrottle.take(`invalid:${String(doc.revision)}`);
    if (!taken) return null;
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    logger.error(
      { event: "map.layer_sets.invalid", dataset: MAP_LAYER_SETS_DATASET, revision: doc.revision, issues, ...taken },
      "Map layer sets dataset fails its schema, not served",
    );
    return null;
  }

  private logRejected(revision: number, rejected: readonly RejectedLayerSet[]): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const { index, layerSetId, issues } of rejected) {
      logger.error(
        { event: "map.layer_sets.invalid_set", dataset: MAP_LAYER_SETS_DATASET, revision, index, layerSetId, issues },
        "Layer set left out: it fails its checks, the other sets serve",
      );
    }
  }

  private datasets(): Collection<MapLayerSetsDatasetDoc> {
    return mongoCollection<MapLayerSetsDatasetDoc>(config.content.dbName, config.content.collections.datasets);
  }
}
