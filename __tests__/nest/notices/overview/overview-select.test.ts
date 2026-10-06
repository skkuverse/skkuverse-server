/**
 * Candidate selection (spec: "Candidate selection"): cross-posted copies count
 * once, the best-ranked copy represents them, and at most 6 notices reach the ai.
 */
import {
  OVERVIEW_CANDIDATE_LIMIT,
  selectCandidates,
} from "../../../../src/notices/overview/overview.select";
import { candidate } from "../../../helpers/overview-fixtures";

describe("selectCandidates", () => {
  it("collapses cross-posted copies to the highest-ranked one", () => {
    const first = candidate({ sourceId: "skku-main", title: "same", contentHash: "h" });
    const copyA = candidate({ sourceId: "skku-notice02", title: "same", contentHash: "h" });
    const other = candidate();
    const copyB = candidate({ sourceId: "skku-notice03", title: " same ", contentHash: "h" });

    const picked = selectCandidates([first, copyA, other, copyB]);

    expect(picked).toEqual([first, other]);
  });

  it("keeps the top 6 distinct notices in rank order", () => {
    const ranked = Array.from({ length: 15 }, () => candidate());

    const picked = selectCandidates(ranked);

    expect(OVERVIEW_CANDIDATE_LIMIT).toBe(6);
    expect(picked).toEqual(ranked.slice(0, 6));
  });

  it("never merges a notice that has no content hash", () => {
    const a = candidate({ title: "same", contentHash: null });
    const b = candidate({ title: "same", contentHash: null });

    expect(selectCandidates([a, b])).toEqual([a, b]);
  });

  it("returns nothing for no results", () => {
    expect(selectCandidates([])).toEqual([]);
  });
});
