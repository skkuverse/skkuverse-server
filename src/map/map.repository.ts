import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import type { ActivationDoc, MapPlaceDoc } from "./map.document";

@Injectable()
export class MapRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("map", () => this.ensureIndexes());
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.places().createIndex({ layerSetId: 1 }),
      // WHY: no geo query runs; the 2dsphere index makes Mongo reject a malformed coordinate pair at insert.
      this.places().createIndex({ location: "2dsphere" }),
      // WHY: compound, so the activation read's sort on activeFrom needs no in-memory stage.
      this.activations().createIndex({ enabled: 1, activeFrom: -1 }),
    ]);
  }

  /**
   * QUIRK(mongodb): `{ field: null }` also matches a missing field, so an activation typed by hand with only
   * `enabled` is unbounded. WHY: sorted, with `_id` last, so replicas pick the same one of two overlapping sets.
   */
  findActiveActivation(now: Date): Promise<ActivationDoc | null> {
    return this.activations().findOne(
      {
        enabled: true,
        $and: [
          { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
          { $or: [{ activeUntil: null }, { activeUntil: { $gt: now } }] },
        ],
      },
      { sort: { activeFrom: -1, _id: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  }

  listPlacesByLayerSetId(layerSetId: string): Promise<MapPlaceDoc[]> {
    return this.places().find({ layerSetId }, { maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
  }

  listPlacesWithDetailByLayerSetId(layerSetId: string): Promise<MapPlaceDoc[]> {
    return this.places().find({ layerSetId, detail: { $ne: null } }, { maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
  }

  private places(): Collection<MapPlaceDoc> {
    return mongoCollection<MapPlaceDoc>(config.eventmap.dbName, config.eventmap.collections.places);
  }

  private activations(): Collection<ActivationDoc> {
    return mongoCollection<ActivationDoc>(config.eventmap.dbName, config.eventmap.collections.activations);
  }
}
