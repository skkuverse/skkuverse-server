import { Injectable } from "@nestjs/common";
import type { Collection, ObjectId } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { NoticeDoc } from "../notices.document";
import { toClaimFilter, toClaimUpdate, toPushedUpdate, toReleasedUpdate } from "./notices-dispatch.query";
import type { ClaimWindow, PushedFields, ReleasedFields } from "./notices-dispatch.types";

// WHY: the only writer of the four push fields in `notices`, so moving them to a collection of their own later
// touches this file alone (ADR 0010 D2).
@Injectable()
export class NoticesDispatchRepository {
  /** SEE: docs/decisions/0003-fcm-dispatch-cloud-function-claim-lease.md — atomic, so two replicas never claim one notice. */
  claimNextPending(window: ClaimWindow, claimedAt: Date): Promise<NoticeDoc | null> {
    return this.notices().findOneAndUpdate(toClaimFilter(window), toClaimUpdate(claimedAt), { returnDocument: "after" });
  }

  async recordPushed(id: ObjectId, fields: PushedFields): Promise<void> {
    await this.notices().updateOne({ _id: id }, toPushedUpdate(fields));
  }

  async recordReleased(id: ObjectId, fields: ReleasedFields): Promise<void> {
    await this.notices().updateOne({ _id: id }, toReleasedUpdate(fields));
  }

  private notices(): Collection<NoticeDoc> {
    return mongoCollection<NoticeDoc>(config.notices.dbName, config.notices.collections.notices);
  }
}
