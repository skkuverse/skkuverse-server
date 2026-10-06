/**
 * Candidate selection for the search overview. Pure / no I/O.
 *
 * Retrieval returns relevance-ranked documents, and a cross-posted article
 * arrives as one document per board it appears on. Sending every copy would
 * spend the ai's few input slots on the same text. The copies are collapsed
 * with the FCM dispatcher's key (trimmed title + contentHash), which never
 * merges two documents on a guess: a document without contentHash stays on
 * its own.
 */
import { groupByDedupKey } from "../notices.dedup-key";

/** How many notices the ai receives. Prod smoke-tested at 6; the ai accepts 1–8. */
export const OVERVIEW_CANDIDATE_LIMIT = 6;

interface Dedupable {
  _id?: unknown;
  title?: string;
  contentHash?: string | null;
}

/**
 * Keeps the highest-ranked copy of each article, in rank order, and caps the
 * result at `limit`. groupByDedupKey preserves first-seen order between groups,
 * so a group's position is its best copy's rank.
 */
export function selectCandidates<T extends Dedupable>(
  ranked: readonly T[],
  limit: number = OVERVIEW_CANDIDATE_LIMIT,
): T[] {
  return groupByDedupKey([...ranked])
    .map((group) => group[0]!)
    .slice(0, limit);
}
