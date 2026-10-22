/**
 * The Mongo form of the search: the $switch compiler (it must agree with the
 * JS twin in building-search.rules.ts through tierRegex), the keyword filter's
 * campus-freedom, the sort keys that make the order total, and the decoding of
 * the $facet document.
 *
 * The compiler, filter and sort tests are structure pins of the aggregation:
 * they say what the pipeline objects look like, not which documents match or
 * in what order they come back. That query meaning is for a real-mongod spec
 * (ADR 0011, D6), so add no other pins here.
 */
import type { Document } from "mongodb";
import { SPACE_TIERS, tierRegex } from "./building-search.rules";
import {
  BUILDING_SEARCH,
  SPACE_SEARCH,
  rankedSearchPipeline,
  spaceKeywordFilter,
  tiersToScoreExpr,
  toRankedResult,
} from "./building-search.query";

describe("tiersToScoreExpr — the Mongo compiler", () => {
  const expr = tiersToScoreExpr(SPACE_TIERS, "27") as {
    $switch: { branches: Array<{ then: number }>; default: number };
  };

  it("emits one branch per tier, descending, with default 0", () => {
    // Assert
    expect(expr.$switch.branches).toHaveLength(SPACE_TIERS.length);
    const scores = expr.$switch.branches.map((br) => br.then);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(expr.$switch.default).toBe(0);
  });

  it("guards every scored input by $type and matches case-insensitively", () => {
    // Act
    const json = JSON.stringify(expr);
    const regexMatches = json.match(/"\$regexMatch"/g) ?? [];
    const typeGuards = json.match(/"\$type"/g) ?? [];
    const options = json.match(/"options":"i"/g) ?? [];

    // Assert
    // $regexMatch throws on non-string input. The guard must be a $type test,
    // not $ifNull — $ifNull covers null/missing but would still hand a NUMBER
    // to $regexMatch, and one such row would 500 the whole endpoint.
    expect(typeGuards).toHaveLength(regexMatches.length);
    expect(json).not.toContain("$ifNull");
    expect(options).toHaveLength(regexMatches.length);
  });

  it("derives its patterns from the shared tierRegex", () => {
    // Act & Assert
    expect(tierRegex("exact", "27")).toBe("^27$");
    expect(tierRegex("prefix", "27")).toBe("^27");
    expect(tierRegex("substring", "27")).toBe("27");
    expect(JSON.stringify(expr)).toContain('"regex":"^27"');
  });
});

describe("spaceKeywordFilter stays campus-free", () => {
  // Counts must report BOTH campuses regardless of the campus param (they feed
  // the campus toggle badge), so campus belongs inside the rows facet only.
  it.each(["27", "204", "도서관"])("has no campus key for q=%s", (q) => {
    // Act & Assert
    expect("campus" in spaceKeywordFilter(q)).toBe(false);
  });
});

/** Each row facet's $sort as ordered pairs: toEqual ignores key order, and a $sort's key order is the sort. */
function rowSorts(pipeline: Document[]): Array<Array<[string, unknown]>> {
  const facet = pipeline.find((stage) => "$facet" in stage)?.["$facet"] as Record<string, Document[]>;
  return ["strong", "weak"].map((name) => {
    const sort = facet[name]?.find((stage) => "$sort" in stage)?.["$sort"] as Document;
    return Object.entries(sort);
  });
}

describe("rankedSearchPipeline — the sort is a total order", () => {
  it("sorts spaces by score, then by their unique key spaceCd, buildNo, campus", () => {
    // Act
    const sorts = rowSorts(rankedSearchPipeline(SPACE_SEARCH, "312"));

    // Assert
    // spaceCd alone ties: 134 production spaceCds are shared across campuses
    // (31214 is in buildNo 131 at hssc and in buildNo 231 at nsc). The unique
    // key is all three; with less, tied rows come back in whatever order the
    // weekly sync left them.
    const unique = [["_score", -1], ["spaceCd", 1], ["buildNo", 1], ["campus", 1]];
    expect(sorts).toEqual([unique, unique]);
  });

  it("sorts buildings by score, then by _id", () => {
    // Act
    const sorts = rowSorts(rankedSearchPipeline(BUILDING_SEARCH, "312"));

    // Assert
    const unique = [["_score", -1], ["_id", 1]];
    expect(sorts).toEqual([unique, unique]);
  });
});

describe("toRankedResult", () => {
  it("maps per-campus groups into the counts envelope", () => {
    // Act
    const r = toRankedResult([
      {
        strong: [1, 2],
        weak: [],
        counts: [{ _id: "nsc" as const, n: 269 }],
        total: [{ n: 269 }],
      },
    ]);

    // Assert
    expect(r.counts).toEqual({ hssc: 0, nsc: 269, total: 269 });
    expect(r.truncated).toBe(true);
  });

  it("concatenates strong before weak so relevance order survives", () => {
    // Act
    const r = toRankedResult([
      {
        strong: ["27101", "27102"],
        weak: ["91227"],
        counts: [{ _id: "nsc" as const, n: 3 }],
        total: [{ n: 3 }],
      },
    ]);

    // Assert
    expect(r.items).toEqual(["27101", "27102", "91227"]);
    expect(r.truncated).toBe(false);
  });

  it("ignores a null campus group rather than folding it into a campus", () => {
    // Act
    const r = toRankedResult([
      {
        strong: [],
        weak: [],
        counts: [
          { _id: null, n: 4 },
          { _id: "hssc" as const, n: 6 },
        ],
        total: [{ n: 10 }],
      },
    ]);

    // Assert
    expect(r.counts).toEqual({ hssc: 6, nsc: 0, total: 6 });
  });

  it("treats an empty $count as zero (not a silent fallback)", () => {
    // Act
    const r = toRankedResult([
      { strong: [], weak: [], counts: [], total: [] },
    ]);

    // Assert
    expect(r.total).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("throws when $facet yields no document — a pipeline-shape bug", () => {
    // Act & Assert
    expect(() => toRankedResult([])).toThrow(
      "[building] search $facet returned no document",
    );
  });
});
