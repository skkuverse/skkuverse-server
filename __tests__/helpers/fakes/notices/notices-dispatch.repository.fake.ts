/**
 * In-memory NoticesDispatchRepository over `notices`, with the real claim's predicates (pinned in
 * notices-dispatch.repository.spec.ts and, over a real mongod, notices-characterization.routes.test.ts): not
 * pushed, summarized, on or after the window's date floor, under the attempt cap, not deleted, and a lease that
 * is free or expired. A claim stamps `dispatchClaimedAt` on the stored notice, as the real `$set` does, and every
 * record write is kept in `records` as the fields it would `$set` and applied to the stored notice.
 */
import type { ObjectId } from "mongodb";
import type { NoticesDispatchRepository } from "../../../../src/notices/dispatch/notices-dispatch.repository";
import type { ClaimWindow, PushedFields, ReleasedFields } from "../../../../src/notices/dispatch/notices-dispatch.types";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

export class FakeNoticesDispatchRepository implements PublicOf<NoticesDispatchRepository> {
  notices: NoticeDoc[] = [];
  records: Array<{ id: ObjectId; fields: PushedFields | ReleasedFields }> = [];

  async onModuleInit(): Promise<void> {}

  async claimNextPending(window: ClaimWindow, claimedAt: Date): Promise<NoticeDoc | null> {
    const next = this.notices.find((notice) => this.isClaimable(notice, window));
    if (!next) return null;
    next.dispatchClaimedAt = claimedAt;
    return { ...next };
  }

  async recordPushed(id: ObjectId, fields: PushedFields): Promise<void> {
    this.record(id, fields);
  }

  async recordReleased(id: ObjectId, fields: ReleasedFields): Promise<void> {
    this.record(id, fields);
  }

  private record(id: ObjectId, fields: PushedFields | ReleasedFields): void {
    this.records.push({ id, fields });
    const stored = this.notices.find((notice) => notice._id.equals(id));
    if (stored) Object.assign(stored, fields, { pushAttempts: (stored.pushAttempts ?? 0) + 1 });
  }

  private isClaimable(notice: NoticeDoc, window: ClaimWindow): boolean {
    const claimedAt = notice.dispatchClaimedAt;
    return (
      notice.pushedAt == null &&
      notice.aiSummaryAt instanceof Date &&
      notice.date >= window.dateFloor &&
      (notice.pushAttempts ?? 0) < window.maxAttempts &&
      notice.isDeleted !== true &&
      (claimedAt == null || claimedAt < window.leaseExpiredBefore)
    );
  }
}
