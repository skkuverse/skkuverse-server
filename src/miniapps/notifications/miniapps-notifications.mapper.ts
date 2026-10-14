import type { SupportedLang } from "../../infra/types";
import type { SentNotificationDoc } from "../miniapps.document";
import { LOG_TITLE_CHARS } from "./miniapps-notifications.constants";
import type { MiniAppNotificationHistoryEntry, NotificationContent, SendTrace } from "./miniapps-notifications.types";
import type { MiniAppFeedEntry } from "./miniapps-notifications.wire";

interface NewNotification {
  id: string;
  miniAppId: string;
  sentAt: Date;
}

const actionOf = ({ actionType, actionValue }: Pick<SentNotificationDoc, "actionType" | "actionValue">): Pick<
  SentNotificationDoc,
  "actionType" | "actionValue"
> => ({ ...(actionType ? { actionType } : {}), ...(actionValue ? { actionValue } : {}) });

export function toSentNotification(content: NotificationContent, { id, miniAppId, sentAt }: NewNotification): SentNotificationDoc {
  const { title_ko, body_ko, title_en, body_en } = content;
  return { _id: id, miniAppId, title_ko, body_ko, title_en, body_en, ...actionOf(content), sentAt, delivery: null };
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
  };
}
