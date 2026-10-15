import { createHash } from "crypto";
import moment from "moment-timezone";
import { NOTICES_TIMEZONE } from "../notices.constants";
import { dedupKeyOf, groupByDedupKey } from "../notices.rules";
import { OVERVIEW_CANDIDATE_LIMIT } from "./notices-overview.constants";
import type { OverviewCandidate } from "./notices-overview.document";

interface OverviewCacheKeyInput {
  q: string;
  sourceIds: readonly string[];
  lang: string;
  now: Date;
  candidates: readonly OverviewCandidate[];
}


/** WHY: the highest-ranked copy of each cross-posted article, keyed as the push dispatch merges them. */
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
  return moment(at).tz(NOTICES_TIMEZONE).format("YYYY-MM-DD");
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
