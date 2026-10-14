import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import logger from "../../infra/logger";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { ShuttleEtaDoc } from "./bus-eta.document";
import type { SequenceLength, UpsertResult } from "./bus-eta.types";

const COLLECTION = "shuttle_eta";

@Injectable()
export class BusEtaRepository implements OnModuleInit {
  // WHY: SHUTTLE_ETA=off (the development default) touches no collection; the TTL index enforces TMAP's 24-hour term.
  onModuleInit(): Promise<void> {
    if (!config.shuttleEta.enabled) {
      logger.info({ event: "bus.eta.disabled" }, "SHUTTLE_ETA=off: arrival-estimate pollers not registered");
      return Promise.resolve();
    }
    return ensureIndexesAtBoot("bus.eta", () => this.ensureIndexes());
  }

  /**
   * WHY: upserts documents by `_id`, leaving an already-frozen one with the same stop count untouched. Refuses the
   * whole batch when a document's offsets do not fit its sequence, which would be a parser bug, not data.
   */
  async upsertEstimates(docs: ShuttleEtaDoc[], sequenceLength: SequenceLength): Promise<UpsertResult> {
    for (const doc of docs) {
      const expected = sequenceLength(doc.serviceId, doc.routeType);
      if (doc.offsetsSec.length !== expected) {
        throw new Error(`shuttle_eta ${doc._id}: ${doc.offsetsSec.length} offsets for a sequence of ${expected ?? "no"} stops`);
      }
    }
    if (docs.length === 0) return { written: 0, skippedFrozen: 0 };
    // WHY: one poller process writes, so reading first keeps a fixed value fixed; one for another stop count is replaced.
    const frozen = await this.estimates()
      .find({ _id: { $in: docs.map((d) => d._id) }, frozen: true }, { projection: { _id: 1, offsetsSec: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
    const frozenLength = new Map(frozen.map((d) => [d._id, d.offsetsSec.length]));
    const toWrite = docs.filter((d) => frozenLength.get(d._id) !== d.offsetsSec.length);
    if (toWrite.length > 0) {
      await this.estimates().bulkWrite(
        toWrite.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
        { ordered: false },
      );
    }
    return { written: toWrite.length, skippedFrozen: docs.length - toWrite.length };
  }

  listEstimates(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]> {
    return this.estimates()
      .find({ serviceId: { $in: serviceIds }, date: { $in: dates } }, { maxTimeMS: HOT_READ_MAX_TIME_MS })
      .toArray();
  }

  // QUIRK(mongo): a TTL sweep can lag by a minute, so the serving read filters on expiresAt too.
  listUnexpired(now: Date): Promise<ShuttleEtaDoc[]> {
    return this.estimates().find({ expiresAt: { $gt: now } }, { maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
  }

  private async ensureIndexes(): Promise<void> {
    await this.estimates().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
    await this.estimates().createIndex({ serviceId: 1, date: 1, kind: 1 }, { name: "serviceId_date_kind" });
  }

  private estimates(): Collection<ShuttleEtaDoc> {
    return mongoCollection<ShuttleEtaDoc>(config.mongo.dbName, COLLECTION);
  }
}
