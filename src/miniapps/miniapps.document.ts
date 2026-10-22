import type { LinkActionType } from "../shared/link-action.wire";
import type { RegistryFile } from "./miniapps.schema";

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
  /** WHY: unique within one mini app where present, so a repeated send finds this row instead of sending again. */
  idempotencyKey?: string;
}

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface MiniAppsDatasetDoc {
  _id: string;
  revision: number;
  data: RegistryFile;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredMiniApps = Pick<MiniAppsDatasetDoc, "revision" | "data">;
