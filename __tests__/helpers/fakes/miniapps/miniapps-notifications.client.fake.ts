/**
 * MiniappsNotificationsClient with a scripted answer, already in the counts
 * the real client translates the Cloud Function's response into
 * (miniapps-notifications.client.spec.ts covers that translation and the
 * payload). An Error as the answer rejects the send. `sent` records every row
 * handed over, in order.
 */
import type { DeliveryCounts, SentNotificationDoc } from "../../../../src/miniapps/miniapps.document";
import type { MiniappsNotificationsClient } from "../../../../src/miniapps/notifications/miniapps-notifications.client";
import type { PublicOf } from "../public-of";

export class FakeMiniappsNotificationsClient implements PublicOf<MiniappsNotificationsClient> {
  answer: DeliveryCounts | Error = { sent: 0, failed: 0, cleanedUp: 0 };
  sent: SentNotificationDoc[] = [];

  async sendPush(doc: SentNotificationDoc): Promise<DeliveryCounts> {
    this.sent.push(doc);
    if (this.answer instanceof Error) throw this.answer;
    return { ...this.answer };
  }
}
