import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";

/** WHY: in the request's language, falling back to Korean: a push carries ko and en only. */
const miniAppFeedEntry = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  sentAt: z.iso.datetime(),
  actionType: linkActionType.optional(),
  actionValue: z.string().optional(),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/miniapps/feed-parse.ts. */
export const miniAppFeed = z.array(miniAppFeedEntry);

const deliveryCounts = z.object({ sent: z.number(), failed: z.number(), cleanedUp: z.number() });

/** WHY: what a send's own call came back as; only `not_sent` is safe to resend. */
const deliveryStatus = z.enum(["delivered", "not_sent", "unknown"]);

/** SEE: docs/reference/miniapps-api.md ("5.4 Signed calls") — what a sender reads back after a send. */
export const sendOutcome = z.object({
  notificationId: z.string(),
  delivery: deliveryCounts.nullable(),
  outcome: deliveryStatus,
  error: z.string().optional(),
});

/** WHY: the sender's own history: the raw Korean pair, and the delivery and key the public feed hides. */
const miniAppNotificationHistoryEntry = z.object({
  id: z.string(),
  title_ko: z.string(),
  body_ko: z.string(),
  title_en: z.string().nullable(),
  body_en: z.string().nullable(),
  actionType: linkActionType.optional(),
  actionValue: z.string().optional(),
  sentAt: z.iso.datetime(),
  delivery: deliveryCounts.nullable(),
  deliveryError: z.object({ outcome: deliveryStatus.exclude(["delivered"]), error: z.string() }).nullable(),
  idempotencyKey: z.string().nullable(),
});

export const miniAppNotificationHistory = z.array(miniAppNotificationHistoryEntry);

export type MiniAppFeedEntry = z.input<typeof miniAppFeedEntry>;

export type MiniAppFeed = z.input<typeof miniAppFeed>;

export type DeliveryStatus = z.input<typeof deliveryStatus>;

export type SendOutcome = z.input<typeof sendOutcome>;

export type MiniAppNotificationHistoryEntry = z.input<typeof miniAppNotificationHistoryEntry>;

export type MiniAppNotificationHistory = z.input<typeof miniAppNotificationHistory>;
