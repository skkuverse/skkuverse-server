import { Injectable, type OnModuleInit } from "@nestjs/common";
import { MongoServerError, type Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { DeliveryCounts, DeliveryError, SentNotificationDoc } from "../miniapps.document";

const DUPLICATE_KEY_CODE = 11000;

@Injectable()
export class MiniappsNotificationsRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("miniapps", () => this.ensureIndexes(), { attempts: 3, backoffMs: 1_000, failLevel: "error" });
  }

  // WHY: the insert is the claim: the unique index refuses a second row with the key, however many sends race.
  async claimSentNotification(doc: SentNotificationDoc): Promise<boolean> {
    try {
      await this.sentNotifications().insertOne(doc);
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === DUPLICATE_KEY_CODE) return false;
      throw err;
    }
  }

  // QUIRK(mongo): the planner takes a partial index only for a filter that restates its `$type`, not for a bare equality.
  findSentNotificationByIdempotencyKey(miniAppId: string, idempotencyKey: string): Promise<SentNotificationDoc | null> {
    const filter = { miniAppId, idempotencyKey: { $eq: idempotencyKey, $type: "string" as const } };
    return this.sentNotifications().findOne(filter, { maxTimeMS: HOT_READ_MAX_TIME_MS });
  }

  async recordDelivery(id: string, delivery: DeliveryCounts): Promise<void> {
    await this.sentNotifications().updateOne({ _id: id }, { $set: { delivery } });
  }

  async recordDeliveryFailure(id: string, deliveryError: DeliveryError): Promise<void> {
    await this.sentNotifications().updateOne({ _id: id }, { $set: { deliveryError } });
  }

  listSentNotifications(miniAppId: string, limit: number): Promise<SentNotificationDoc[]> {
    return this.sentNotifications()
      .find({ miniAppId }, { maxTimeMS: HOT_READ_MAX_TIME_MS })
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();
  }

  // WHY: the feed reads newest first within one mini app, the moment a push wakes every subscriber.
  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.sentNotifications().createIndex({ miniAppId: 1, sentAt: -1 }),
      this.sentNotifications().createIndex(
        { miniAppId: 1, idempotencyKey: 1 },
        { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } }, name: "miniAppId_idempotencyKey_unique" },
      ),
    ]);
  }

  private sentNotifications(): Collection<SentNotificationDoc> {
    return mongoCollection<SentNotificationDoc>(config.miniapps.dbName, config.miniapps.collections.sentNotifications);
  }
}
