/**
 * The root's shared decisions: the content-identity grouping key (skkuverse-server#75), the summary type, the
 * search text, the source-id list and the cross-references of the committed tab files.
 *
 * The grouping key decides which notice documents collapse into a single FCM push.
 *
 * The key decides which notice documents collapse into a single FCM push, so
 * both directions are safety-critical and both are pinned here:
 *   - failing to merge  → the duplicate-notification bug returns;
 *   - merging too eagerly → a real notice is swallowed and never delivered,
 *     which is the worse of the two. Hence "exact match only, no fuzz".
 */

import { ObjectId } from "mongodb";
import { AppError } from "../http/app.error";
import {
  categoryReferenceProblems,
  dedupKeyOf,
  excludeReasonProblems,
  groupByDedupKey,
  isSummaryType,
  normalizeSummaryType,
  toSearchQuery,
  toSourceIds,
} from "./notices.rules";
import type { CategoryConfig, SourceConfig } from "./notices.types";

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

describe("groupByDedupKey", () => {
  it("collapses an 8-way cross-post into one group", () => {
    // Arrange
    // skku-main + skku-notice02..08 — the family reported in the issue.
    const sources = [
      "skku-main",
      "skku-notice02",
      "skku-notice03",
      "skku-notice04",
      "skku-notice05",
      "skku-notice06",
      "skku-notice07",
      "skku-notice08",
    ];

    // Act
    const groups = groupByDedupKey(sources.map((sourceId) => doc({ sourceId })));

    // Assert
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(8);
  });

  it("keeps genuinely different articles in separate groups", () => {
    // Act
    const groups = groupByDedupKey([
      doc({ title: "공지 A" }),
      doc({ title: "공지 A" }),
      doc({ title: "공지 B" }),
    ]);

    // Assert
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 2]);
  });

  it("preserves first-seen order between and within groups", () => {
    // Arrange
    // Determinism matters: the dispatcher picks a representative per group and
    // sweeps should be reproducible.
    const first = doc({ title: "A", sourceId: "s1" });
    const second = doc({ title: "B", sourceId: "s2" });
    const third = doc({ title: "A", sourceId: "s3" });

    // Act
    const groups = groupByDedupKey([first, second, third]);

    // Assert
    expect(groups[0]!.map((d) => d.sourceId)).toEqual(["s1", "s3"]);
    expect(groups[1]!.map((d) => d.sourceId)).toEqual(["s2"]);
  });

  it("returns no groups for an empty batch", () => {
    // Act & Assert
    expect(groupByDedupKey([])).toEqual([]);
  });
});

describe("isSummaryType", () => {
  it.each([
    ["action_required", true],
    ["event", true],
    ["informational", true],
    ["bogus", false],
    ["", false],
    [undefined, false],
  ])("%j → %j", (value, expected) => {
    // Act & Assert
    expect(isSummaryType(value)).toBe(expected);
  });
});

describe("normalizeSummaryType", () => {
  it("keeps a known type and turns anything else into informational", () => {
    // Act & Assert
    expect([normalizeSummaryType("event"), normalizeSummaryType("bogus"), normalizeSummaryType(null)]).toEqual([
      "event",
      "informational",
      "informational",
    ]);
  });
});

describe("toSearchQuery", () => {
  it.each([
    ["  hello  ", "hello"],
    ["가".repeat(100), "가".repeat(100)],
    ["😀".repeat(100), "😀".repeat(100)],
    ["", null],
    ["   ", null],
    ["x".repeat(101), null],
    ["😀".repeat(101), null],
    ["abc\u0000def", null],
    ["abc\u007fdef", null],
    [["a"], null],
    [undefined, null],
  ])("%j → %j", (raw, expected) => {
    // Act & Assert
    expect(toSearchQuery(raw)).toBe(expected);
  });
});

describe("toSourceIds", () => {
  const known = (id: string): boolean => id.startsWith("ok-");

  it("splits, trims and drops empty ids", () => {
    // Act & Assert
    expect(toSourceIds(" ok-a, ,ok-b ,", known)).toEqual(["ok-a", "ok-b"]);
  });

  it("takes one id and twenty ids", () => {
    // Arrange
    const twenty = Array.from({ length: 20 }, (_, i) => `ok-${i}`).join(",");

    // Act & Assert
    expect([toSourceIds("ok-a", known), toSourceIds(twenty, known)].map((ids) => ids.length)).toEqual([1, 20]);
  });

  it.each(["", " , ", Array.from({ length: 21 }, (_, i) => `ok-${i}`).join(",")])("refuses no ids or more than twenty (%#)", (raw) => {
    // Act & Assert
    expect(() => toSourceIds(raw, known)).toThrow(
      new AppError("INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required", 400),
    );
  });

  it("checks the count before the ids, and names the first unknown id", () => {
    // Act & Assert
    expect(() => toSourceIds("ok-a,nope,also-nope", known)).toThrow(
      new AppError("INVALID_SOURCE_ID", "unknown sourceId: nope", 400),
    );
  });
});

describe("categoryReferenceProblems", () => {
  const sourceIds = new Set(["a", "b", "c"]);
  const label = { ko: "가", en: "A" };

  it("passes tabs whose sources, defaults and campus seeds all hold", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "a" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "b"], maxSelection: 2, defaultIds: ["a"], campusDefaultIds: { hssc: ["b"] } },
    ];

    // Act & Assert
    expect(categoryReferenceProblems(categories, sourceIds)).toEqual([]);
  });

  it("names each broken reference with its category's index and id", () => {
    // Arrange
    const categories: CategoryConfig[] = [
      { id: "fixed", label, tabMode: "fixed", sourceId: "x" },
      { id: "picker", label, tabMode: "picker", sourceIds: ["a", "y"], maxSelection: 1, defaultIds: ["c"], campusDefaultIds: { nsc: ["a"] } },
    ];

    // Act
    const problems = categoryReferenceProblems(categories, sourceIds);

    // Assert
    expect(problems).toEqual([
      'categories[0] (fixed): sourceId "x" not found in sources.json',
      'categories[1] (picker): sourceId "y" in sourceIds not found in sources.json',
      'categories[1] (picker): defaultIds "c" is not in sourceIds',
      'categories[1] (picker): seed for campus "nsc" has 2 ids > maxSelection 1',
    ]);
  });
});

describe("excludeReasonProblems", () => {
  const source = (excludeReason: string | null): SourceConfig => ({
    id: "s",
    name: "S",
    campus: "hssc",
    college: null,
    appCategory: null,
    crawlAvailable: excludeReason === null,
    excludeReason,
    hasCategory: true,
    hasAuthor: true,
  });

  it("names a source whose reason has no copy, and passes one that has or needs none", () => {
    // Act
    const problems = excludeReasonProblems([source(null), source("known"), source("missing")], { known: { ko: "알려진" } });

    // Assert
    expect(problems).toEqual(['sources.json: "s" has excludeReason "missing" with no entry in exclude-reasons.json']);
  });
});
