import type { MiniAppPushQuota, QuotaDecision } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers every send with `decision`, allowed until a test sets it, and keeps the senders it was asked for. */
export class FakeMiniAppPushQuota implements PublicOf<MiniAppPushQuota> {
  decision: QuotaDecision = { allowed: true };
  readonly senders: string[] = [];

  take(senderId: string): Promise<QuotaDecision> {
    this.senders.push(senderId);
    return Promise.resolve(this.decision);
  }
}
