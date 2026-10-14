import type { LinkActionType } from "../shared/link-action.wire";

export interface DeliveryCounts {
  sent: number;
  failed: number;
  cleanedUp: number;
}

/**
 * WHY: `not_sent` is a refusal before any send, safe to retry; `unknown` (a timeout, a network error, a
 * 5xx) may have reached devices, so it is never resent until the Cloud Function log says otherwise.
 */
export interface DeliveryError {
  outcome: "not_sent" | "unknown";
  error: string;
}

/** SEE: docs/explanation/miniapps-architecture.md — broadcast-only by decision: no uid, no read state. */
export interface SentNotificationDoc {
  /** WHY: also the `notificationId` the Cloud Function echoes back in the FCM data map. */
  _id: string;
  miniAppId: string;
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  actionType?: LinkActionType;
  actionValue?: string;
  sentAt: Date;
  /** WHY: null is not "not delivered": `deliveryError` says whether the call may have reached devices. */
  delivery: DeliveryCounts | null;
  deliveryError?: DeliveryError;
}
