import type { FcmResponse } from "../../infra/fcm";

/** WHY: derived from the four push fields alone; the stored documents carry no status field. */
export type DispatchStatus = "pending" | "claimed" | "pushed" | "exhausted";

export interface DispatchPolicy {
  maxAgeDays: number;
  claimLeaseMs: number;
  maxAttempts: number;
  sweepBatchCap: number;
}

export interface ClaimWindow {
  dateFloor: string;
  leaseExpiredBefore: Date;
  maxAttempts: number;
}

export interface PushedFields {
  pushedAt: Date;
  dispatchClaimedAt: null;
  pushError: null;
}

export interface ReleasedFields {
  dispatchClaimedAt: null;
  pushError: string;
}

export interface DispatchOutcome {
  result: "sent" | "failed" | "skippedNoTopics";
  fnResponse?: FcmResponse;
  error?: unknown;
}

export interface DispatchPing {
  source?: string;
  cycleId?: string;
  crawledAt?: string;
}
