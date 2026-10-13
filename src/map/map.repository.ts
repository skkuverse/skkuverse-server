import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { parseEach } from "../shared/zod-list.util";
import type { ActivationDoc, MapPlaceDoc, OverlayPlaceDoc, SheetPlaceDoc } from "./map.document";
import { overlayPlaceDoc, sheetPlaceDoc } from "./map.schema";

const OVERLAY_PLACE_FIELDS = {
  _id: 1,
  campus: 1,
  category: 1,
  location: 1,
  title: 1,
  subtitle: 1,
  hours: 1,
  fields: 1,
  actions: 1,
  order: 1,
  facets: 1,
  orderByOption: 1,
} as const;

const SHEET_PLACE_FIELDS = { _id: 1, category: 1, location: 1, title: 1, hours: 1, fields: 1, actions: 1, detail: 1 } as const;

const placeIdOf = (doc: unknown): string => String((doc as { _id?: unknown })._id);

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

  async listPlacesByLayerSetId(layerSetId: string): Promise<OverlayPlaceDoc[]> {
    const docs = await this.places().find({ layerSetId }, { projection: OVERLAY_PLACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
    const { valid, invalid } = parseEach(docs, overlayPlaceDoc, placeIdOf);
    if (invalid.length > 0) {
      logger.warn({ event: "map.event_overlays.places_unrenderable", layerSetId, count: invalid.length }, "Places not renderable, skipped");
    }
    return valid;
  }

  async listPlacesWithDetailByLayerSetId(layerSetId: string): Promise<SheetPlaceDoc[]> {
    const docs = await this.places()
      .find({ layerSetId, detail: { $ne: null } }, { projection: SHEET_PLACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const { valid, invalid } = parseEach(docs, sheetPlaceDoc, placeIdOf);
    if (invalid.length > 0) {
      logger.warn(
        { event: "map.event_details.places_unrenderable", layerSetId, count: invalid.length, invalid },
        "Places not renderable, no sheet served",
      );
    }
    return valid;
  }

  private places(): Collection<MapPlaceDoc> {
    return mongoCollection<MapPlaceDoc>(config.eventmap.dbName, config.eventmap.collections.places);
  }

  private activations(): Collection<ActivationDoc> {
    return mongoCollection<ActivationDoc>(config.eventmap.dbName, config.eventmap.collections.activations);
  }
}
