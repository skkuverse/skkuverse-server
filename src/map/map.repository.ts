import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { createLogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../infra/mongo";
import { isRecord } from "../shared/object.util";
import { parseEach } from "../shared/zod-list.util";
import type { ActivationDoc, LiveActivation, MapPlaceDoc, OverlayPlaceDoc, SheetPlaceDoc } from "./map.document";
import { OVERLAY_PLACE_FIELDS, SHEET_PLACE_FIELDS } from "./map.query";
import { liveActivation, overlayPlaceDoc, sheetPlaceDoc } from "./map.schema";

// WHY: read every TTL, so a bad activation is reported hourly, not every five seconds.
const INVALID_ACTIVATION_LOG_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class MapRepository implements OnModuleInit {
  private readonly invalidActivationThrottle = createLogThrottle(INVALID_ACTIVATION_LOG_INTERVAL_MS);

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
  async findActiveActivation(now: Date): Promise<LiveActivation | null> {
    const activation = await this.activations().findOne(
      {
        enabled: true,
        $and: [
          { $or: [{ activeFrom: null }, { activeFrom: { $lte: now } }] },
          { $or: [{ activeUntil: null }, { activeUntil: { $gt: now } }] },
        ],
      },
      { projection: { _id: 1, activeUntil: 1 }, sort: { activeFrom: -1, _id: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
    if (activation === null) return null;
    const parsed = liveActivation.safeParse(activation);
    if (!parsed.success) this.warnInvalidActivation(this.idOf(activation));
    return parsed.success ? parsed.data : null;
  }

  async listPlacesByLayerSetId(layerSetId: string): Promise<OverlayPlaceDoc[]> {
    const docs = await this.places().find({ layerSetId }, { projection: OVERLAY_PLACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
    const { valid, invalid } = parseEach(docs, overlayPlaceDoc, (doc) => this.idOf(doc));
    if (invalid.length > 0) {
      logger.warn({ event: "map.event_overlays.places_unrenderable", layerSetId, count: invalid.length }, "Places not renderable, skipped");
    }
    return valid;
  }

  async listPlacesWithDetailByLayerSetId(layerSetId: string): Promise<SheetPlaceDoc[]> {
    const docs = await this.places()
      .find({ layerSetId, detail: { $ne: null } }, { projection: SHEET_PLACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const { valid, invalid } = parseEach(docs, sheetPlaceDoc, (doc) => this.idOf(doc));
    if (invalid.length > 0) {
      logger.warn(
        { event: "map.event_details.places_unrenderable", layerSetId, count: invalid.length, invalid },
        "Places not renderable, no sheet served",
      );
    }
    return valid;
  }

  private warnInvalidActivation(activationId: string): void {
    const ticket = this.invalidActivationThrottle.take(activationId);
    if (!ticket) return;
    logger.warn(
      { event: "map.eventmap.activation_invalid", activationId, suppressed: ticket.suppressed },
      "Live activation left out: it does not match the document schema",
    );
  }

  private idOf(doc: unknown): string {
    return String(isRecord(doc) ? doc._id : undefined);
  }

  private places(): Collection<MapPlaceDoc> {
    return mongoCollection<MapPlaceDoc>(config.eventmap.dbName, config.eventmap.collections.places);
  }

  private activations(): Collection<ActivationDoc> {
    return mongoCollection<ActivationDoc>(config.eventmap.dbName, config.eventmap.collections.activations);
  }
}
