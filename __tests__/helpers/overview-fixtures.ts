/**
 * Shared builders for the search-overview tests (__tests__/nest/notices/overview/).
 * Lives under helpers/ so jest does not collect it as a suite.
 */
import { ObjectId } from "mongodb";
import type { AiOverviewResponse } from "../../src/notices/overview/notices-overview.schema";
import type { OverviewCandidate } from "../../src/notices/overview/notices-overview.document";

let seq = 0;

/** A candidate with a unique title and hash unless overridden. */
// WHY: `articleNo` takes a string too, as some route tests seed one; production documents hold a number.
export function candidate(
  extra: Partial<Omit<OverviewCandidate, "articleNo">> & { articleNo?: number | string } = {},
): OverviewCandidate {
  seq += 1;
  return {
    _id: new ObjectId(),
    sourceId: "skku-main",
    articleNo: 140000 + seq,
    title: `notice ${seq}`,
    date: "2026-09-20",
    contentHash: `hash-${seq}`,
    ...(extra as Partial<OverviewCandidate>),
  };
}

export function aiResponse(
  extra: Partial<AiOverviewResponse> = {},
): AiOverviewResponse {
  return {
    status: "answered",
    lead: { text: "lead sentence", cites: [1] },
    points: [{ text: "point sentence", cites: [1] }],
    sources: [{ n: 1, contentMissing: false }],
    lang: "ko",
    model: "test-model",
    ...extra,
  };
}
