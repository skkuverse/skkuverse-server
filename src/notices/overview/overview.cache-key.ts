/**
 * Cache key for a generated overview. Pure / no I/O.
 *
 * Two requests share an overview only when the ai would have been asked the
 * same thing:
 *  - the same normalized query and the same set of sources and language;
 *  - the same KST date, because deadline status ("D-1", "closed") is computed
 *    from the reference time and changes at midnight, not within a day;
 *  - the same candidates with the same content, so an edited notice is never
 *    answered from its old text. Candidates are identified by their dedup key
 *    (title + contentHash, or the _id fallback), in rank order.
 */
import { createHash } from "crypto";
import moment from "moment-timezone";
import { dedupKeyOf } from "../notices.dedup-key";
import type { OverviewCandidate } from "./overview.contract";

/** Trim, collapse inner whitespace to one space, lower-case. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Calendar date in Asia/Seoul, YYYY-MM-DD. */
export function kstDate(at: Date): string {
  return moment(at).tz("Asia/Seoul").format("YYYY-MM-DD");
}

export interface OverviewCacheKeyInput {
  q: string;
  sourceIds: readonly string[];
  lang: string;
  now: Date;
  candidates: readonly OverviewCandidate[];
}

export function overviewCacheKey(input: OverviewCacheKeyInput): string {
  const parts = [
    normalizeQuery(input.q),
    [...new Set(input.sourceIds)].sort(),
    input.lang,
    kstDate(input.now),
    input.candidates.map((c) => dedupKeyOf(c)),
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
