import type { Collection } from "mongodb";
import { getClient, HOT_READ_MAX_TIME_MS } from "../infra/db";
import config from "../infra/config";
import logger from "../infra/logger";
import type { DeliveryError, SentNotificationDoc } from "./types";

/**
 * Mongo access for the mini-app broadcast feed.
 *
 * The registry itself stays static JSON in-repo (miniapps.ts) — this is only the
 * send log, which is the one part of the mini-app surface that is data rather
 * than config.
 *
 * dbName is guaranteed a string by the startup validation in infra/config.ts
 * (required[] carries miniapps.dbName → a missing env var is process.exit(1)),
 * which is what justifies the non-null assertion. Same pattern as map-places.data.ts.
 */

export function getSentNotificationsCollection(): Collection<SentNotificationDoc> {
  return getClient()
    .db(config.miniapps.dbName!)
    .collection<SentNotificationDoc>(config.miniapps.collections.sentNotifications);
}

/**
 * The only query the feed runs: newest-first within one mini app.
 *
 * Descending on sentAt so the index serves the sort as well as the filter —
 * without it Mongo sorts in memory, and the feed is read exactly when a push
 * has just woken a few thousand devices at once.
 */
export async function ensureIndexes(): Promise<void> {
  await getSentNotificationsCollection().createIndex({ miniAppId: 1, sentAt: -1 });
  logger.info({ event: "miniapps.indexes.ensured" }, "Indexes ensured");
}

export async function insertSentNotification(doc: SentNotificationDoc): Promise<void> {
  await getSentNotificationsCollection().insertOne(doc);
}

/** Patch in what the Cloud Function reported, after the fact. */
export async function recordDelivery(
  id: string,
  delivery: SentNotificationDoc["delivery"],
): Promise<void> {
  await getSentNotificationsCollection().updateOne({ _id: id }, { $set: { delivery } });
}

/** Record why the call failed, so the history can say whether to retry. */
export async function recordDeliveryFailure(id: string, deliveryError: DeliveryError): Promise<void> {
  await getSentNotificationsCollection().updateOne({ _id: id }, { $set: { deliveryError } });
}

export async function listSentNotifications(
  miniAppId: string,
  limit: number,
): Promise<SentNotificationDoc[]> {
  return getSentNotificationsCollection()
    .find({ miniAppId }, { maxTimeMS: HOT_READ_MAX_TIME_MS })
    .sort({ sentAt: -1 })
    .limit(limit)
    .toArray();
}
