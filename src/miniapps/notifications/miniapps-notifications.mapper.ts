import type { SupportedLang } from "../../infra/types";
import type { SentNotificationDoc } from "../miniapps.document";
import { LOG_TITLE_CHARS, NO_RECORDED_OUTCOME_ERROR } from "./miniapps-notifications.constants";
import type { PushMapTarget } from "./miniapps-notifications.schema";
import type { NotificationContent } from "../../perimeter/perimeter.ports";
import type { MiniAppNotificationHistoryEntry, SendOutcome, SendTrace } from "./miniapps-notifications.types";
import type { MiniAppFeedEntry } from "./miniapps-notifications.wire";

interface NewNotification {
  id: string;
  miniAppId: string;
  sentAt: Date;
  idempotencyKey?: string;
}

const actionOf = ({ actionType, actionValue }: Pick<SentNotificationDoc, "actionType" | "actionValue">): Pick<
  SentNotificationDoc,
  "actionType" | "actionValue"
> => ({ ...(actionType ? { actionType } : {}), ...(actionValue ? { actionValue } : {}) });

const mapTargetOf = ({ chipId, placeId }: PushMapTarget): Pick<SentNotificationDoc, "chipId" | "placeId"> => ({
  ...(chipId ? { chipId } : {}),
  ...(placeId ? { placeId } : {}),
});

export function toSentNotification(
  content: NotificationContent & PushMapTarget,
  { id, miniAppId, sentAt, idempotencyKey }: NewNotification,
): SentNotificationDoc {
  const { title_ko, body_ko, title_en, body_en } = content;
  const key = idempotencyKey === undefined ? {} : { idempotencyKey };
  return { _id: id, miniAppId, title_ko, body_ko, title_en, body_en, ...actionOf(content), ...mapTargetOf(content), sentAt, delivery: null, ...key };
}

export function toNotificationContent({ title_ko, body_ko, title_en, body_en, ...rest }: SentNotificationDoc): NotificationContent & PushMapTarget {
  return { title_ko, body_ko, title_en, body_en, ...actionOf(rest), ...mapTargetOf(rest) };
}

// WHY: a row with no recorded outcome may still be sending, so a repeat is told unknown, never invited to resend.
export function toReplayedOutcome({ _id: notificationId, delivery, deliveryError }: SentNotificationDoc): SendOutcome {
  if (delivery) return { notificationId, delivery, outcome: "delivered" };
  if (deliveryError) return { notificationId, delivery: null, outcome: deliveryError.outcome, error: deliveryError.error };
  return { notificationId, delivery: null, outcome: "unknown", error: NO_RECORDED_OUTCOME_ERROR };
}

export function toSendTrace(doc: SentNotificationDoc): SendTrace {
  return {
    miniAppId: doc.miniAppId,
    notificationId: doc._id,
    title: doc.title_ko.slice(0, LOG_TITLE_CHARS),
    ...(doc.actionType ? { actionType: doc.actionType, actionValue: doc.actionValue } : {}),
    hasEn: doc.title_en !== null,
  };
}

export function toFeedEntry(doc: SentNotificationDoc, lang: SupportedLang): MiniAppFeedEntry {
  const useEnglish = lang === "en";
  return {
    id: doc._id,
    title: (useEnglish ? doc.title_en : null) ?? doc.title_ko,
    body: (useEnglish ? doc.body_en : null) ?? doc.body_ko,
    sentAt: doc.sentAt.toISOString(),
    ...actionOf(doc),
  };
}

// WHY: `?? null` on every optional field: rows written before a field existed lack it.
export function toHistoryEntry(doc: SentNotificationDoc): MiniAppNotificationHistoryEntry {
  return {
    id: doc._id,
    title_ko: doc.title_ko,
    body_ko: doc.body_ko,
    title_en: doc.title_en ?? null,
    body_en: doc.body_en ?? null,
    ...actionOf(doc),
    sentAt: doc.sentAt.toISOString(),
    delivery: doc.delivery ?? null,
    deliveryError: doc.deliveryError ?? null,
    idempotencyKey: doc.idempotencyKey ?? null,
  };
}
