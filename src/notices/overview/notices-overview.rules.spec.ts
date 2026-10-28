/**
 * Cache key: what makes two requests share an overview.
 * Candidate selection: cross-posted copies count
 * once, the best-ranked copy represents them, and at most 6 notices reach the ai.
 * The cluster key, the crawler's `dupOf` or the notice's own _id, decides which candidates are copies of one
 * article, as it does for the list and the push. Both directions matter: failing to merge spends a candidate slot on
 * a copy, and merging too eagerly drops a real notice from the answer.
 */
import { ObjectId } from "mongodb";
import { candidate } from "../../../__tests__/helpers/overview-fixtures";
import { OVERVIEW_CANDIDATE_LIMIT } from "./notices-overview.constants";
import { dedupKeyOf, kstDate, normalizeQuery, overviewCacheKey, selectCandidates } from "./notices-overview.rules";

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
  it("collapses the copies the crawler linked to the highest-ranked one", () => {
    // Arrange
    const anchor = new ObjectId();
    const first = candidate({ _id: anchor, sourceId: "skku-main", title: "same", contentHash: "h", dupOf: anchor });
    const copyA = candidate({ sourceId: "skku-notice02", title: "same", contentHash: "h", dupOf: anchor });
    const other = candidate();
    const copyB = candidate({ sourceId: "skku-notice03", title: " same ", contentHash: "h", dupOf: anchor });

    // Act
    const picked = selectCandidates([first, copyA, other, copyB]);

    // Assert
    expect(picked).toEqual([first, other]);
  });

  it("collapses copies on the crawler's link alone, whichever copy ranks first", () => {
    // Arrange
    const anchor = new ObjectId();
    const ranked = [candidate({ title: "edited", dupOf: anchor }), candidate({ dupOf: anchor }), candidate({ _id: anchor, dupOf: anchor })];

    // Act & Assert
    expect(selectCandidates(ranked)).toEqual([ranked[0]]);
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

  it("never merges notices the crawler has not linked, even with the same title and hash", () => {
    // Arrange
    const a = candidate({ title: "same", contentHash: "h" });

    // Act
    const b = candidate({ title: "same", contentHash: "h" });

    // Assert
    expect(selectCandidates([a, b])).toEqual([a, b]);
  });

  it("returns nothing for no results", () => {
    // Act & Assert
    expect(selectCandidates([])).toEqual([]);
  });
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function doc(extra: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    sourceId: "skku-notice02",
    articleNo: 138897,
    title: "공지 제목",
    contentHash: HASH_A,
    ...extra,
  };
}

describe("dedupKeyOf", () => {
  it("gives identical keys to same title + same contentHash across sources", () => {
    // Arrange
    // The prod cross-post shape: one article, N board views, byte-identical HTML.
    const a = doc({ sourceId: "skku-notice02" });

    // Act
    const b = doc({ sourceId: "skku-notice07" });

    // Assert
    expect(dedupKeyOf(a)).toBe(dedupKeyOf(b));
  });

  it("trims surrounding whitespace in the title", () => {
    // Act & Assert
    expect(dedupKeyOf(doc({ title: "  공지 제목  " }))).toBe(
      dedupKeyOf(doc({ title: "공지 제목" })),
    );
  });

  it("separates documents whose titles differ", () => {
    // Act & Assert
    expect(dedupKeyOf(doc({ title: "공지 A" }))).not.toBe(
      dedupKeyOf(doc({ title: "공지 B" })),
    );
  });

  it("separates documents whose contentHash differs (edited after posting)", () => {
    // Act & Assert
    // 0.8% of prod sibling groups: one board's copy was edited, so the hashes
    // diverge. They must NOT merge — different content, different notice.
    expect(dedupKeyOf(doc({ contentHash: HASH_A }))).not.toBe(
      dedupKeyOf(doc({ contentHash: HASH_B })),
    );
  });

  it("cannot be fooled by a title/hash boundary shift", () => {
    // Act & Assert
    // "ab"+"c" must never collide with "a"+"bc" — the unit separator is why.
    expect(dedupKeyOf({ _id: new ObjectId(), title: "ab", contentHash: "c" })).not.toBe(
      dedupKeyOf({ _id: new ObjectId(), title: "a", contentHash: "bc" }),
    );
  });

  it("falls back to a per-document identity key when contentHash is missing", () => {
    // Arrange
    // Detail fetch failed → body never hashed → merging is declined, not guessed.
    const a = doc({ contentHash: null });

    // Act
    const b = doc({ contentHash: null });

    // Assert
    expect(dedupKeyOf(a)).not.toBe(dedupKeyOf(b));
    expect(dedupKeyOf(a)).toBe(`id:${String(a._id)}`);
  });

  it("keeps hash-keyed and identity-keyed namespaces disjoint", () => {
    // Arrange
    const withHash = dedupKeyOf(doc());

    // Act
    const withoutHash = dedupKeyOf(doc({ contentHash: undefined }));

    // Assert
    expect(withHash.startsWith("h:")).toBe(true);
    expect(withoutHash.startsWith("id:")).toBe(true);
  });

  it("does not throw on null/undefined input", () => {
    // Assert
    expect(typeof dedupKeyOf(null)).toBe("string");
    expect(typeof dedupKeyOf(undefined)).toBe("string");
  });
});
