import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { DeliveryCounts, DeliveryError, SentNotificationDoc } from "../miniapps.document";

@Injectable()
export class MiniappsNotificationsRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("miniapps", () => this.ensureIndexes());
  }

  async insertSentNotification(doc: SentNotificationDoc): Promise<void> {
    await this.sentNotifications().insertOne(doc);
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
    await this.sentNotifications().createIndex({ miniAppId: 1, sentAt: -1 });
  }

  private sentNotifications(): Collection<SentNotificationDoc> {
    return mongoCollection<SentNotificationDoc>(config.miniapps.dbName, config.miniapps.collections.sentNotifications);
  }
}
