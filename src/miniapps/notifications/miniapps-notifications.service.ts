import { randomUUID } from "crypto";
import { isDeepStrictEqual } from "util";
import { Injectable } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import type { NotificationContent, NotificationDraft } from "../../perimeter/perimeter.ports";
import { FEED_CACHE_TTL_MS } from "../miniapps.constants";
import type { DeliveryCounts, SentNotificationDoc } from "../miniapps.document";
import { MiniappsNotificationsClient } from "./miniapps-notifications.client";
import { REUSED_IDEMPOTENCY_KEY_MESSAGE, SIGNED_SEND_NEEDS_IDEMPOTENCY_KEY_MESSAGE } from "./miniapps-notifications.constants";
import { toFeedEntry, toHistoryEntry, toNotificationContent, toReplayedOutcome, toSendTrace, toSentNotification } from "./miniapps-notifications.mapper";
import { MiniappsNotificationsRepository } from "./miniapps-notifications.repository";
import { classifyDeliveryFailure } from "./miniapps-notifications.rules";
import { idempotencyKeyHeader, pushMapTarget, type PushMapTarget } from "./miniapps-notifications.schema";
import { isRecord } from "../../shared/object.util";
import { MiniappsSenderService } from "../sender/miniapps-sender.service";
import type { PushSender } from "../sender/miniapps-sender.types";
import type { SendResult, SendTrace } from "./miniapps-notifications.types";
import type { MiniAppFeed, MiniAppNotificationHistoryEntry, SendOutcome } from "./miniapps-notifications.wire";

const ERROR_TEXT_CHARS = 500;

interface SendAttempt {
  doc: SentNotificationDoc;
  trace: SendTrace;
  startedAt: Date;
}

// SEE: docs/explanation/miniapps-architecture.md — the feed entry is written, then delivered: one operation.
@Injectable()
export class MiniappsNotificationsService {
  // WHY: one loader per mini app, holding the documents, so ko and en share one read.
  private readonly feedLoaders = new Map<string, CachedLoader<SentNotificationDoc[]>>();

  constructor(
    private readonly repository: MiniappsNotificationsRepository,
    private readonly client: MiniappsNotificationsClient,
    private readonly clock: Clock,
    private readonly senders: MiniappsSenderService,
  ) {}

  async send(sender: PushSender, draft: NotificationDraft, idempotencyKeyValue: string): Promise<SendResult> {
    const { miniAppId, keyId } = sender;
    const startedAt = this.clock.now();
    const idempotencyKey = this.toIdempotencyKey(sender, idempotencyKeyValue);
    const checked = await this.checkSend(sender, draft);
    if ("problems" in checked) {
      // WHY: the exception filter does not log an AppError, so a refused payload would leave only a bare 400.
      logger.warn({ event: "miniapps.notify.request_invalid", miniAppId, keyId, problems: checked.problems }, "Send refused: invalid payload");
      return checked;
    }
    // WHY: read before the claim, so a sequential repeat is answered even where the unique index is not built yet.
    const doc = toSentNotification(checked.content, { id: randomUUID(), miniAppId, sentAt: startedAt, idempotencyKey });
    const trace = toSendTrace(doc, sender);
    const stored = await this.repository.findSentNotificationByIdempotencyKey(miniAppId, idempotencyKey);
    if (stored) return this.replay(stored, doc, trace);
    const quota = await this.senders.takeQuota(sender);
    if (!quota.allowed) {
      logger.warn({ event: "miniapps.notify.quota_exceeded", miniAppId, keyId, retryAfterSeconds: quota.retryAfterSeconds }, "Send refused: the sender's quota is spent");
      return { retryAfterSeconds: quota.retryAfterSeconds };
    }
    const result = await this.publish(doc, idempotencyKey, trace);
    logger.info(
      {
        event: "miniapps.notify.request_completed",
        miniAppId,
        keyId,
        notificationId: result.notificationId,
        outcome: result.outcome,
        sent: result.delivery?.sent ?? null,
        durationMs: this.elapsedMs(startedAt),
      },
      "Send request completed",
    );
    return result;
  }

  // WHY: the signature covers the key; without one, a replay within the timestamp window would send again.
  refuseUnkeyedSignedSend({ miniAppId, keyId }: PushSender): never {
    logger.warn({ event: "miniapps.notify.idempotency_key_invalid", miniAppId, keyId }, "Send refused: a signed send needs an Idempotency-Key");
    throw new AppError("INVALID_IDEMPOTENCY_KEY", SIGNED_SEND_NEEDS_IDEMPOTENCY_KEY_MESSAGE, 400);
  }

  async feed(miniAppId: string, lang: SupportedLang): Promise<MiniAppFeed> {
    const docs = await this.feedLoader(miniAppId).get();
    return docs.map((doc) => toFeedEntry(doc, lang));
  }

  // WHY: uncached: only the console reads it, and it must show a send's result once its record is written.
  async history(miniAppId: string): Promise<MiniAppNotificationHistoryEntry[]> {
    const docs = await this.repository.listSentNotifications(miniAppId, config.miniapps.feedLimit);
    return docs.map(toHistoryEntry);
  }

  private feedLoader(miniAppId: string): CachedLoader<SentNotificationDoc[]> {
    const existing = this.feedLoaders.get(miniAppId);
    if (existing) return existing;
    const loader = createCachedLoader<SentNotificationDoc[]>({
      name: `miniapp-feed:${miniAppId}`,
      ttlMs: FEED_CACHE_TTL_MS,
      load: () => this.repository.listSentNotifications(miniAppId, config.miniapps.feedLimit),
    });
    this.feedLoaders.set(miniAppId, loader);
    return loader;
  }

  // WHY: the map target is parsed beside the draft's checks, so the 400 lists its problem after theirs.
  private async checkSend(sender: PushSender, draft: NotificationDraft): Promise<{ problems: string[] } | { content: NotificationContent & PushMapTarget }> {
    const checked = await this.senders.checkDraft(sender, draft);
    const mapTarget = pushMapTarget.safeParse(draft);
    if ("content" in checked && mapTarget.success) return { content: { ...checked.content, ...mapTarget.data } };
    const mapTargetProblems = mapTarget.success ? [] : mapTarget.error.issues.map((issue) => issue.message);
    return { problems: [...("problems" in checked ? checked.problems : []), ...mapTargetProblems] };
  }

  private toIdempotencyKey({ miniAppId, keyId }: PushSender, value: string): string {
    const parsed = idempotencyKeyHeader.safeParse(value);
    if (parsed.success) return parsed.data;
    const message = parsed.error.issues[0]?.message ?? "invalid Idempotency-Key";
    logger.warn({ event: "miniapps.notify.idempotency_key_invalid", miniAppId, keyId }, "Send refused: invalid Idempotency-Key");
    throw new AppError("INVALID_IDEMPOTENCY_KEY", message, 400);
  }

  // WHY: a key reused for another notification is refused: the first one's outcome would report a send that never happened.
  private replay(stored: SentNotificationDoc, requested: SentNotificationDoc, { keyId }: SendTrace): SendOutcome {
    const trace = { miniAppId: stored.miniAppId, keyId, notificationId: stored._id, idempotencyKey: stored.idempotencyKey };
    if (!isDeepStrictEqual(toNotificationContent(stored), toNotificationContent(requested))) {
      logger.warn({ event: "miniapps.notify.idempotency_key_reused", ...trace }, "Send refused: Idempotency-Key already used for a different notification");
      throw new AppError("IDEMPOTENCY_KEY_REUSED", REUSED_IDEMPOTENCY_KEY_MESSAGE, 422);
    }
    const outcome = toReplayedOutcome(stored);
    logger.info(
      { event: "miniapps.notify.replayed", ...trace, outcome: outcome.outcome },
      "Idempotency-Key repeat: answered the stored outcome; nothing sent",
    );
    return outcome;
  }

  // WHY: a key another send claimed first is answered from that row: the claim, not the read before it, settles a race.
  private async replayClaimed(doc: SentNotificationDoc, idempotencyKey: string, trace: SendTrace): Promise<SendOutcome> {
    const stored = await this.repository.findSentNotificationByIdempotencyKey(doc.miniAppId, idempotencyKey);
    if (!stored) throw new Error(`Idempotency-Key ${idempotencyKey} of ${doc.miniAppId} is held by no stored row`);
    return this.replay(stored, doc, trace);
  }

  private async publish(doc: SentNotificationDoc, idempotencyKey: string, trace: SendTrace): Promise<SendOutcome> {
    let claimed: boolean;
    try {
      claimed = await this.repository.claimSentNotification(doc);
    } catch (err: unknown) {
      logger.error({ event: "miniapps.notify.feed_insert_failed", ...trace, err }, "Feed insert failed — NOTHING was sent; safe to retry");
      throw err;
    }
    if (!claimed) return this.replayClaimed(doc, idempotencyKey, trace);
    // WHY: after the insert, so a read racing it cannot pin the old feed; the other replicas converge within one TTL.
    this.feedLoaders.get(doc.miniAppId)?.clear();
    logger.info({ event: "miniapps.notify.feed_written", ...trace }, "Feed entry written; calling the Cloud Function");
    return this.deliver({ doc, trace, startedAt: this.clock.now() });
  }

  // WHY: only the call is in the try: "not delivered" invites a retry, and a retry after a delivery pushes everyone twice.
  private async deliver(attempt: SendAttempt): Promise<SendOutcome> {
    let delivery: DeliveryCounts;
    try {
      delivery = await this.client.sendPush(attempt.doc);
    } catch (err: unknown) {
      return this.recordFailure(attempt, err);
    }
    return this.recordDelivered(attempt, delivery);
  }

  private async recordFailure({ doc, trace, startedAt }: SendAttempt, err: unknown): Promise<SendOutcome> {
    const message = err instanceof Error ? err.message : String(err);
    const deliveryError = { outcome: classifyDeliveryFailure(err), error: message.slice(0, ERROR_TEXT_CHARS) };
    const { outcome } = deliveryError;
    logger.error(
      {
        event: "miniapps.notify.send_failed",
        ...trace,
        outcome,
        status: isRecord(err) && typeof err.status === "number" ? err.status : null,
        timedOut: isRecord(err) && err.name === "AbortError",
        durationMs: this.elapsedMs(startedAt),
        err,
      },
      outcome === "not_sent"
        ? "Cloud Function REFUSED the send — nothing sent; safe to retry after fixing the cause"
        : "Cloud Function outcome UNKNOWN — devices may have it; check its log for this notificationId before resending",
    );
    try {
      await this.repository.recordDeliveryFailure(doc._id, deliveryError);
    } catch (recordErr: unknown) {
      logger.error(
        { event: "miniapps.notify.failure_record_failed", ...trace, outcome, err: recordErr },
        "Could not record the failed call on the feed row",
      );
    }
    return { notificationId: doc._id, delivery: null, outcome, error: message };
  }

  // WHY: a failed record after a delivery is logged, not reported as a failed send: that lie costs a duplicate broadcast.
  private async recordDelivered({ doc, trace, startedAt }: SendAttempt, delivery: DeliveryCounts): Promise<SendOutcome> {
    const durationMs = this.elapsedMs(startedAt);
    let recordFailed = false;
    try {
      await this.repository.recordDelivery(doc._id, delivery);
    } catch (err: unknown) {
      recordFailed = true;
      logger.error(
        { event: "miniapps.notify.delivery_record_failed", ...trace, ...delivery, err },
        "DELIVERED but the delivery record failed to write — do NOT resend",
      );
    }
    logger.info({ event: "miniapps.notify.sent", ...trace, ...delivery, durationMs, recordFailed }, "Notification sent");
    return { notificationId: doc._id, delivery, outcome: "delivered" };
  }

  private elapsedMs(startedAt: Date): number {
    return this.clock.now().getTime() - startedAt.getTime();
  }
}
