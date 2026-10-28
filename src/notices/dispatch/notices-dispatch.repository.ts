import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection, ObjectId } from "mongodb";
import config from "../../infra/config";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { NoticeDoc } from "../notices.document";
import { CLAIM_SORT, DISPATCH_PENDING_INDEX, toClaimFilter, toClaimUpdate, toPushedUpdate, toReleasedUpdate, toSkippedUpdate } from "./notices-dispatch.query";
import type { ClaimWindow, PushedFields, ReleasedFields, SkippedFields } from "./notices-dispatch.types";

// WHY: the only writer of the five push fields in `notices`, so moving them to a collection of their own later
// touches this file alone (ADR 0010 D2).
@Injectable()
export class NoticesDispatchRepository implements OnModuleInit {
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("notices.dispatch", () => this.ensureIndexes());
  }

  /** SEE: docs/decisions/0003-fcm-dispatch-cloud-function-claim-lease.md — atomic, so two replicas never claim one notice. */
  claimNextPending(window: ClaimWindow, claimedAt: Date): Promise<NoticeDoc | null> {
    return this.notices().findOneAndUpdate(toClaimFilter(window), toClaimUpdate(claimedAt), { sort: CLAIM_SORT, returnDocument: "after" });
  }

  async recordPushed(id: ObjectId, fields: PushedFields): Promise<void> {
    await this.notices().updateOne({ _id: id }, toPushedUpdate(fields));
  }

  async recordSkipped(id: ObjectId, fields: SkippedFields): Promise<void> {
    await this.notices().updateOne({ _id: id }, toSkippedUpdate(fields));
  }

  async recordReleased(id: ObjectId, fields: ReleasedFields): Promise<void> {
    await this.notices().updateOne({ _id: id }, toReleasedUpdate(fields));
  }

  // EVIDENCE: without it the claim's date predicate plans a COLLSCAN (9,390 documents, 223 MB per sweep on prod,
  // 2026-09-13); the partial index holds only the claimable set.
  private async ensureIndexes(): Promise<void> {
    await this.notices().createIndex(DISPATCH_PENDING_INDEX.key, DISPATCH_PENDING_INDEX.options);
  }

  private notices(): Collection<NoticeDoc> {
    return mongoCollection<NoticeDoc>(config.notices.dbName, config.notices.collections.notices);
  }
}
