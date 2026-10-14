import type { Document } from "mongodb";
import type { ClaimWindow, PushedFields, ReleasedFields } from "./notices-dispatch.types";

/**
 * QUIRK(atlas): `aiSummaryAt: { $type: "date" }`, not `$ne: null`, matches dispatch_pending_idx's partial filter so
 * the planner uses it (a partial index takes no `$ne`); `$not: { $gte }`, not `$lt`, so a fresh notice with no
 * pushAttempts field matches too: `$lt` is false against a missing field.
 */
export function toClaimFilter(window: ClaimWindow): Document {
  return {
    pushedAt: null,
    aiSummaryAt: { $type: "date" },
    date: { $gte: window.dateFloor },
    pushAttempts: { $not: { $gte: window.maxAttempts } },
    isDeleted: { $ne: true },
    $or: [
      { dispatchClaimedAt: null },
      { dispatchClaimedAt: { $exists: false } },
      { dispatchClaimedAt: { $lt: window.leaseExpiredBefore } },
    ],
  };
}

export function toClaimUpdate(claimedAt: Date): Document {
  return { $set: { dispatchClaimedAt: claimedAt } };
}

export function toPushedUpdate(fields: PushedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}

export function toReleasedUpdate(fields: ReleasedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}
