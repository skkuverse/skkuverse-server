import { createHash } from "crypto";
import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import { OVERVIEW_CANDIDATE_LIMIT } from "./notices-overview.constants";
import type { OverviewCandidate } from "./notices-overview.document";

interface DedupFields {
  _id?: unknown;
  title?: string;
  contentHash?: string | null;
}

// WHY: U+001F cannot appear in a title or a hex digest, so "a" + "bc" never meets "ab" + "c".
const KEY_SEPARATOR = "\u001f";

interface OverviewCacheKeyInput {
  q: string;
  sourceIds: readonly string[];
  lang: string;
  now: Date;
  candidates: readonly OverviewCandidate[];
}

/**
 * SEE: docs/decisions/0005-notice-dispatch-content-group.md — one article cross-posted to several boards shares
 * its trimmed title and contentHash; without a hash a notice keys on its _id and never merges.
 */
export function dedupKeyOf(doc: DedupFields | null | undefined): string {
  const contentHash = doc && doc.contentHash;
  if (contentHash) return `h:${(doc && doc.title ? doc.title : "").trim()}${KEY_SEPARATOR}${contentHash}`;
  return `id:${doc && doc._id != null ? String(doc._id) : ""}`;
}

export function groupByDedupKey<T extends DedupFields>(docs: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const doc of docs) {
    const key = dedupKeyOf(doc);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  return Array.from(groups.values());
}

/** WHY: the highest-ranked copy of each cross-posted article, keyed as the crawler links copies into `dupOf`. */
export function selectCandidates<T extends Pick<OverviewCandidate, "_id" | "title" | "contentHash">>(
  ranked: readonly T[],
  limit: number = OVERVIEW_CANDIDATE_LIMIT,
): T[] {
  return groupByDedupKey([...ranked])
    .flatMap((group) => group.slice(0, 1))
    .slice(0, limit);
}

export function normalizeQuery(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function kstDate(at: Date): string {
  return moment(at).tz(KST_TIME_ZONE).format("YYYY-MM-DD");
}

/**
 * WHY: two requests share an overview only when the ai would be asked the same thing: the same query, sources,
 * language, KST day (deadline status turns at midnight) and candidates by content, so an edited notice is a new key.
 */
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
