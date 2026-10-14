/**
 * In-memory NoticesDispatchRepository: `pending` holds the notices a claim hands out, in order, and every
 * record write is kept in `records` as the fields it would `$set`. The claim filter itself is pinned in
 * notices-dispatch.repository.spec.ts and over a real mongod in notices-characterization.routes.test.ts.
 */
import type { ObjectId } from "mongodb";
import type { NoticesDispatchRepository } from "../../../../src/notices/dispatch/notices-dispatch.repository";
import type { ClaimWindow, PushedFields, ReleasedFields } from "../../../../src/notices/dispatch/notices-dispatch.types";
import type { NoticeDoc } from "../../../../src/notices/notices.document";
import type { PublicOf } from "../public-of";

export class FakeNoticesDispatchRepository implements PublicOf<NoticesDispatchRepository> {
  pending: NoticeDoc[] = [];
  records: Array<{ id: ObjectId; fields: PushedFields | ReleasedFields }> = [];

  async claimNextPending(_window: ClaimWindow, claimedAt: Date): Promise<NoticeDoc | null> {
    const next = this.pending.shift();
    return next ? { ...next, dispatchClaimedAt: claimedAt } : null;
  }

  async recordPushed(id: ObjectId, fields: PushedFields): Promise<void> {
    this.records.push({ id, fields });
  }

  async recordReleased(id: ObjectId, fields: ReleasedFields): Promise<void> {
    this.records.push({ id, fields });
  }
}
