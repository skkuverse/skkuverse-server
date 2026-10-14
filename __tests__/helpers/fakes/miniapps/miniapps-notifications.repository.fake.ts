/**
 * In-memory MiniappsNotificationsRepository over sent_notifications, with the
 * real read's filter, sort and limit (pinned in
 * miniapps-notifications.repository.spec.ts): one mini app's rows, newest
 * first. The two record writes set their field on the row, as `$set` does.
 * `failWith` makes every call reject.
 */
import type { DeliveryCounts, DeliveryError, SentNotificationDoc } from "../../../../src/miniapps/miniapps.document";
import type { MiniappsNotificationsRepository } from "../../../../src/miniapps/notifications/miniapps-notifications.repository";
import type { PublicOf } from "../public-of";

export class FakeMiniappsNotificationsRepository implements PublicOf<MiniappsNotificationsRepository> {
  notifications: SentNotificationDoc[] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async insertSentNotification(doc: SentNotificationDoc): Promise<void> {
    this.fail();
    this.notifications.push({ ...doc });
  }

  async recordDelivery(id: string, delivery: DeliveryCounts): Promise<void> {
    this.fail();
    this.update(id, { delivery });
  }

  async recordDeliveryFailure(id: string, deliveryError: DeliveryError): Promise<void> {
    this.fail();
    this.update(id, { deliveryError });
  }

  async listSentNotifications(miniAppId: string, limit: number): Promise<SentNotificationDoc[]> {
    this.fail();
    return this.notifications
      .filter((doc) => doc.miniAppId === miniAppId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }

  private update(id: string, fields: Partial<SentNotificationDoc>): void {
    const doc = this.notifications.find((row) => row._id === id);
    if (doc) Object.assign(doc, fields);
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
