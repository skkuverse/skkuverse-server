/**
 * Cache key: what makes two requests share an overview.
 * Candidate selection: cross-posted copies count
 * once, the best-ranked copy represents them, and at most 6 notices reach the ai.
 */
import { candidate } from "../../../__tests__/helpers/overview-fixtures";
import { OVERVIEW_CANDIDATE_LIMIT } from "./notices-overview.constants";
import { kstDate, normalizeQuery, overviewCacheKey, selectCandidates } from "./notices-overview.rules";

type OverviewCacheKeyInput = Parameters<typeof overviewCacheKey>[0];

const NOON_KST = new Date("2026-10-06T03:00:00Z");

function base(extra: Partial<OverviewCacheKeyInput> = {}): OverviewCacheKeyInput {
  return {
    q: "장학금 신청",
    sourceIds: ["skku-main", "cs"],
    lang: "ko",
    now: NOON_KST,
    candidates: [
      candidate({ title: "a", contentHash: "ha" }),
      candidate({ title: "b", contentHash: "hb" }),
    ],
    ...extra,
  };
}

describe("normalizeQuery", () => {
  it("trims, collapses inner whitespace and lower-cases", () => {
    // Act & Assert
    expect(normalizeQuery("  ROTC   지원\t언제 ")).toBe("rotc 지원 언제");
  });
});

describe("kstDate", () => {
  it("uses the Asia/Seoul calendar date", () => {
    // Act & Assert
    expect(kstDate(new Date("2026-10-06T14:59:00Z"))).toBe("2026-10-06");
    expect(kstDate(new Date("2026-10-06T15:01:00Z"))).toBe("2026-10-07");
  });
});

describe("overviewCacheKey", () => {
  it("is the same for queries that differ only in spacing", () => {
    // Act
    const input = base();

    // Assert
    expect(overviewCacheKey({ ...input, q: "장학금  신청" })).toBe(
      overviewCacheKey({ ...input, q: " 장학금 신청" }),
    );
  });

  it("ignores the order and repetition of sourceIds", () => {
    // Act
    const input = base();

    // Assert
    expect(overviewCacheKey({ ...input, sourceIds: ["cs", "skku-main", "cs"] })).toBe(
      overviewCacheKey(input),
    );
  });

  it("changes when a candidate's content hash changes", () => {
    // Arrange
    const input = base();

    // Act
    const edited = [
      { ...input.candidates[0]!, contentHash: "ha-edited" },
      input.candidates[1]!,
    ];

    // Assert
    expect(overviewCacheKey({ ...input, candidates: edited })).not.toBe(
      overviewCacheKey(input),
    );
  });

  it("changes across KST midnight", () => {
    // Act
    const input = base();

    // Assert
    expect(
      overviewCacheKey({ ...input, now: new Date("2026-10-06T14:59:00Z") }),
    ).not.toBe(overviewCacheKey({ ...input, now: new Date("2026-10-06T15:01:00Z") }));
  });

  it("changes with the language", () => {
    // Act
    const input = base();

    // Assert
    expect(overviewCacheKey({ ...input, lang: "en" })).not.toBe(overviewCacheKey(input));
  });
});

describe("selectCandidates", () => {
  it("collapses cross-posted copies to the highest-ranked one", () => {
    // Arrange
    const first = candidate({ sourceId: "skku-main", title: "same", contentHash: "h" });
    const copyA = candidate({ sourceId: "skku-notice02", title: "same", contentHash: "h" });
    const other = candidate();
    const copyB = candidate({ sourceId: "skku-notice03", title: " same ", contentHash: "h" });

    // Act
    const picked = selectCandidates([first, copyA, other, copyB]);

    // Assert
    expect(picked).toEqual([first, other]);
  });

  it("keeps the top 6 distinct notices in rank order", () => {
    // Arrange
    const ranked = Array.from({ length: 15 }, () => candidate());

    // Act
    const picked = selectCandidates(ranked);

    // Assert
    expect(OVERVIEW_CANDIDATE_LIMIT).toBe(6);
    expect(picked).toEqual(ranked.slice(0, 6));
  });

  it("never merges a notice that has no content hash", () => {
    // Arrange
    const a = candidate({ title: "same", contentHash: null });

    // Act
    const b = candidate({ title: "same", contentHash: null });

    // Assert
    expect(selectCandidates([a, b])).toEqual([a, b]);
  });

  it("returns nothing for no results", () => {
    // Act & Assert
    expect(selectCandidates([])).toEqual([]);
  });
});
