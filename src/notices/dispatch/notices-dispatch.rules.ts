import moment from "moment-timezone";
import { NOTICES_TIMEZONE } from "../notices.constants";
import type { NoticeDoc } from "../notices.document";
import type { ClaimWindow, DispatchPolicy, PushedFields, ReleasedFields } from "./notices-dispatch.types";

// WHY: a push error is kept for a person to read: 500 characters hold the Cloud Function's status and message.
const MAX_PUSH_ERROR_LENGTH = 500;

/**
 * SEE: docs/decisions/0008-dispatch-age-gate-on-publication-date.md — the gate is the notice's own `date`, a KST
 * day the crawler never rewrites, so its floor is a KST day too: a UTC day would move the boundary by 9 hours.
 */
export function toClaimWindow(now: Date, policy: Pick<DispatchPolicy, "maxAgeDays" | "claimLeaseMs" | "maxAttempts">): ClaimWindow {
  return {
    dateFloor: moment(now).tz(NOTICES_TIMEZONE).subtract(policy.maxAgeDays, "days").format("YYYY-MM-DD"),
    leaseExpiredBefore: new Date(now.getTime() - policy.claimLeaseMs),
    maxAttempts: policy.maxAttempts,
  };
}

export function toPushedFields(at: Date): PushedFields {
  return { pushedAt: at, dispatchClaimedAt: null, pushError: null };
}

// WHY: a failed send releases the lease, so the next sweep retries it while attempts remain.
export function toReleasedFields(err: unknown): ReleasedFields {
  const message = err instanceof Error ? err.message : String(err);
  return { dispatchClaimedAt: null, pushError: message.slice(0, MAX_PUSH_ERROR_LENGTH) };
}

/**
 * SEE: docs/decisions/0005-notice-dispatch-content-group.md — the push links one (sourceId, articleNo): the
 * lowest sourceId among members that have a topic, so it never lands on a topic-less mirror such as skku-main.
 */
export function selectRepresentative<T extends Pick<NoticeDoc, "sourceId">>(members: readonly T[], hasTopic: (doc: T) => boolean): T {
  const representative = [...members].sort((a, b) => String(a.sourceId).localeCompare(String(b.sourceId))).find(hasTopic) ?? members[0];
  if (representative === undefined) throw new Error("a push group has no members");
  return representative;
}
