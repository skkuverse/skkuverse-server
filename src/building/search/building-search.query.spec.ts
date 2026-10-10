/**
 * The Mongo form of the search: the $switch compiler (it must agree with the
 * JS twin in building-search.rules.ts through tierRegex), the keyword filter's
 * campus-freedom, and the decoding of the $facet document.
 *
 * The compiler and filter tests are structure pins of the aggregation: they say
 * what the pipeline objects look like, not which documents match or in what
 * order. That query meaning is for a real-mongod spec (harden-test-suite D6), so
 * add no new pins here.
 */
import { SPACE_TIERS, tierRegex } from "./building-search.rules";
import { spaceKeywordFilter, tiersToScoreExpr, toRankedResult } from "./building-search.query";

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
