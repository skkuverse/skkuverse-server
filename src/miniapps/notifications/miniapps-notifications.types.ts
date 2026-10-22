import type { LinkActionType } from "../../shared/link-action.wire";
import type { DeliveryCounts, DeliveryError } from "../miniapps.document";

export interface NotificationDraft {
  title_ko?: unknown;
  body_ko?: unknown;
  title_en?: unknown;
  body_en?: unknown;
  actionType?: unknown;
  actionValue?: unknown;
}

export interface NotificationContent {
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  actionType?: LinkActionType;
  actionValue?: string;
}

export type DraftCheck = { problems: string[] } | { content: NotificationContent };

/** WHY: what a send's own call came back as; a stored row with both fields null is still running, or never saved. */
export type DeliveryStatus = "delivered" | DeliveryError["outcome"];

export interface SendOutcome {
  notificationId: string;
  delivery: DeliveryCounts | null;
  /** WHY: what the operator may do next: only `not_sent` is safe to resend. */
  outcome: DeliveryStatus;
  /** WHY: present when the Cloud Function call failed; the feed entry exists either way. */
  error?: string;
}

/** WHY: the operator console's history: the raw Korean pair, and the delivery the public feed hides. */
export interface MiniAppNotificationHistoryEntry {
  id: string;
  title_ko: string;
  body_ko: string;
  title_en: string | null;
  body_en: string | null;
  actionType?: LinkActionType;
  actionValue?: string;
  sentAt: string;
  delivery: DeliveryCounts | null;
  deliveryError: DeliveryError | null;
  idempotencyKey: string | null;
}

export interface SendTrace {
  miniAppId: string;
  notificationId: string;
  title: string;
  actionType?: LinkActionType;
  actionValue?: string;
  hasEn: boolean;
}
