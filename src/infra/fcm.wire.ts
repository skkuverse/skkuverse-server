import { z } from "zod";
import { linkActionType } from "../shared/link-action.wire";

/** WHY: the notice request shape of the app's push function (Firebase, maintained outside this repository). */
export const noticePushPayload = z.object({
  type: z.literal("notice"),
  noticeId: z.string(),
  /** WHY: one send for a notice cross-posted to several boards: the union of their topics. */
  topics: z.array(z.string()),
  title_ko: z.string(),
  body_ko: z.string(),
  title_en: z.string().nullable(),
  body_en: z.string().nullable(),
  sourceId: z.string().optional(),
  articleNo: z.string().optional(),
  category: z.string().optional(),
});

/** WHY: the mini-app request shape of the app's push function (Firebase, maintained outside this repository); no `topics`. */
export const miniAppPushPayload = z.object({
  type: z.literal("miniapp"),
  miniAppId: z.string(),
  /** WHY: the feed entry's id, written before the send, so the feed and the delivery can be matched. */
  notificationId: z.string(),
  title_ko: z.string(),
  body_ko: z.string(),
  title_en: z.string().nullable(),
  body_en: z.string().nullable(),
  actionType: linkActionType.optional(),
  actionValue: z.string().optional(),
  /**
   * WHY: the push function copies a fixed list of keys into the device's data, and that list does not hold
   * these two yet, so a device receives them only once the function names them.
   */
  chipId: z.string().optional(),
  placeId: z.string().optional(),
});

/** WHY: the Cloud Function relays the data fields to the device unchanged, so the server owns them. */
export const pushPayload = z.discriminatedUnion("type", [noticePushPayload, miniAppPushPayload]);

export type NoticePushPayload = z.input<typeof noticePushPayload>;

export type MiniAppPushPayload = z.input<typeof miniAppPushPayload>;

export type PushPayload = z.input<typeof pushPayload>;
