import { Injectable, type OnModuleInit } from "@nestjs/common";
import { MongoBulkWriteError, type Collection } from "mongodb";
import config from "../../../infra/config";
import { ensureIndexesAtBoot, mongoCollection } from "../../../infra/mongo";
import type { HsscFeedEventDoc } from "./bus-realtime-hssc.document";

const COLLECTION = "hssc_feed_events";
const DUPLICATE_KEY_CODE = 11000;
// WHY: long enough to hold an exam period and the weeks around it for the ETA model this log trains.
const RETENTION_SECONDS = 180 * 24 * 60 * 60;

@Injectable()
export class BusRealtimeHsscRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("bus.hssc.feed_events", () => this.ensureIndexes());
  }

  // WHY: unordered, so an event the unique index already holds fails alone and the rest of the batch is stored.
  async recordFeedEvents(events: HsscFeedEventDoc[]): Promise<number> {
    if (events.length === 0) return 0;
    try {
      return (await this.feedEvents().insertMany(events, { ordered: false })).insertedCount;
    } catch (err) {
      if (err instanceof MongoBulkWriteError && this.isDuplicateOnly(err)) return err.insertedCount;
      throw err;
    }
  }

  private async ensureIndexes(): Promise<void> {
    await this.feedEvents().createIndex(
      { lineNo: 1, seq: 1, getDate: 1, inout: 1 },
      { unique: true, name: "lineNo_seq_getDate_inout_unique" },
    );
    await this.feedEvents().createIndex({ polledAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS, name: "polledAt_ttl" });
  }

  private isDuplicateOnly(err: MongoBulkWriteError): boolean {
    const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
    return writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY_CODE);
  }

  private feedEvents(): Collection<HsscFeedEventDoc> {
    return mongoCollection<HsscFeedEventDoc>(config.mongo.dbName, COLLECTION);
  }
}
