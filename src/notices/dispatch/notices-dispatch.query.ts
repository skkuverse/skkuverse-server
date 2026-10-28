import type { Document } from "mongodb";
import type { ClaimWindow, PushedFields, ReleasedFields, SkippedFields } from "./notices-dispatch.types";

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

// EVIDENCE: newest first, so a backlog over sweepBatchCap sends today's notices before old ones (umbrella issue 76).
// The plan stays an IXSCAN of dispatch_pending_idx plus a top-1 SORT over the partial index, 9 documents on prod
// (explain, 2026-10-16); `_id` orders one day's notices.
export const CLAIM_SORT = { date: -1, _id: -1 } as const;

export function toClaimUpdate(claimedAt: Date): Document {
  return { $set: { dispatchClaimedAt: claimedAt } };
}

export function toPushedUpdate(fields: PushedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}

export function toSkippedUpdate(fields: SkippedFields): Document {
  return { $set: fields };
}

export function toReleasedUpdate(fields: ReleasedFields): Document {
  return { $set: fields, $inc: { pushAttempts: 1 } };
}

// WHY: the partial filter is the claimable set, which is why the claim filter says `aiSummaryAt: { $type: "date" }`;
// the name is the one prod already holds, so the boot's createIndex is a no-op there.
export const DISPATCH_PENDING_INDEX = {
  key: { date: -1 },
  options: { name: "dispatch_pending_idx", partialFilterExpression: { pushedAt: null, aiSummaryAt: { $type: "date" } } },
} as const;

// WHY: ships one deploy ahead of the claim that reads it (ADR 0012, D3); keyed on CLAIM_SORT, so the claim walks
// the index in order instead of sorting the partial set.
export const DISPATCH_PENDING_FACTS_INDEX = {
  key: { date: -1, _id: -1 },
  options: { name: "dispatch_pending_facts_idx", partialFilterExpression: { pushedAt: null, factsAt: { $type: "date" } } },
} as const;
