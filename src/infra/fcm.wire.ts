import { z } from "zod";
import { linkActionType } from "../shared/link-action.wire";

/** (An operations detail is left out of the public history.) */
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

/** (An operations detail is left out of the public history.) */
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
});

/** WHY: the Cloud Function relays the data fields to the device unchanged, so the server owns them. */
export const pushPayload = z.discriminatedUnion("type", [noticePushPayload, miniAppPushPayload]);

export type NoticePushPayload = z.input<typeof noticePushPayload>;

export type MiniAppPushPayload = z.input<typeof miniAppPushPayload>;

export type PushPayload = z.input<typeof pushPayload>;
