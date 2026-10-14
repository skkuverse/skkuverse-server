import { Injectable } from "@nestjs/common";
import { postToFcmFunction } from "../../infra/fcm";
import type { MiniAppPushPayload } from "../../infra/fcm.wire";
import type { DeliveryCounts, SentNotificationDoc } from "../miniapps.document";

@Injectable()
export class MiniappsNotificationsClient {
  // WHY: a count the Cloud Function leaves out is recorded as 0, so the history always holds three numbers.
  async sendPush(doc: SentNotificationDoc): Promise<DeliveryCounts> {
    const res = await postToFcmFunction(this.toPayload(doc));
    return { sent: Number(res.sent ?? 0), failed: Number(res.failed ?? 0), cleanedUp: Number(res.cleanedUp ?? 0) };
  }

  // WHY: no `topics`: the Cloud Function targets `miniapp:<miniAppId>` itself, so a sender cannot reach another topic.
  private toPayload(doc: SentNotificationDoc): MiniAppPushPayload {
    const { miniAppId, _id: notificationId, title_ko, body_ko, title_en, body_en, actionType, actionValue } = doc;
    return {
      type: "miniapp",
      miniAppId,
      notificationId,
      title_ko,
      body_ko,
      title_en,
      body_en,
      ...(actionType ? { actionType } : {}),
      ...(actionValue ? { actionValue } : {}),
    };
  }
}
