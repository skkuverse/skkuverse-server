/**
 * Building and room search matching and relevance ranking. Ranking is asserted
 * through scoreLocally, the JS twin of the Mongo $switch compiled from the same
 * tier table via the same tierRegex(), so ordering is pinned without a live
 * MongoDB. The Mongo compiler and the facet decoding are pinned in
 * building-search.query.spec.ts, the pipeline assembly in
 * building-search.repository.spec.ts.
 *
 * Two regression queries (issue #91: a `{ spaceCd: query }` equality shipped
 * instead of a regex), chosen because they fail differently:
 *   q=27  — the 168 rooms of Engineering Building II, wing 27, are already in the match set today
 *           (their building NAME contains "27"); they just lost the unsorted
 *           20-row window to dormitory noise. Pins ORDERING.
 *   q=204 — the Law building has no digits in its name, so its rooms (20401, 20404, ...)
 *           are unreachable by any prefix of their own code. Pins RECALL.
 */

import type { Document } from "mongodb";
import { buildingKeywordFilter, spaceKeywordFilter } from "./building-search.query";
import {
  BUILDING_SEARCH_LIMIT,
  BUILDING_TIERS,
  SPACE_SEARCH_LIMIT,
  SPACE_STRONG_MIN_SCORE,
  SPACE_TIERS,
  SPACE_WEAK_LIMIT,
  scoreLocally,
} from "./building-search.rules";

/** Minimal room shape for scoring — only the paths the tier table reads. */
function room(
  spaceCd: unknown,
  nameKo: string,
  buildingNameKo: string,
): Record<string, unknown> {
  return {
    spaceCd,
    name: { ko: nameKo, en: "" },
    buildingName: { ko: buildingNameKo, en: "" },
  };
}

describe("room ranking (q=27) — the reported bug", () => {
  const engineering = room("27101", "측량기기성능검사실", "제2공학관27동");
  const dormCode = room("91227", "남자숙실(1227)", "기숙사지관");
  const dormNameOnly = room("29802001", "숙실(271)", "기숙사신관");

  it("ranks a spaceCd prefix hit above a code-substring hit above a name-only hit", () => {
    // Act & Assert
    expect(scoreLocally(SPACE_TIERS, "27", engineering)).toBe(50);
    expect(scoreLocally(SPACE_TIERS, "27", dormCode)).toBe(20);
    expect(scoreLocally(SPACE_TIERS, "27", dormNameOnly)).toBe(5);
  });

  it("scores every room of building 27 into one tier above all dorm noise", () => {
    // Act
    const building27 = [
      room("27101", "측량기기성능검사실", "제2공학관27동"),
      room("27114A", "교육매체지원실", "제2공학관27동"),
      room("27422", "SSIT 강의실", "제2공학관27동"),
    ].map((r) => scoreLocally(SPACE_TIERS, "27", r));
    const noise = [dormCode, dormNameOnly].map((r) => scoreLocally(SPACE_TIERS, "27", r));

    // Assert
    // The property that matters: the WHOLE prefix tier outranks the WHOLE rest,
    // so no dormitory row can ever appear between two of building 27's rooms.
    expect(new Set(building27)).toEqual(new Set([50]));
    expect(Math.min(...building27)).toBeGreaterThan(Math.max(...noise));
  });

  it("is not satisfied by the OLD equality predicate (regression guard)", () => {
    // Arrange
    // The bug was `{ spaceCd: query }`. Reproduce it and assert it fails to find
    // the room, so this test would go red if the equality ever came back.
    const oldPredicateMatches = (q: string, cd: string): boolean => cd === q;

    // Act
    const or = spaceKeywordFilter("27").$or as Document[];
    const clause = or.find((c) => "spaceCd" in c) as {
      spaceCd: { $regex: string; $options: string };
    };

    // Assert
    expect(oldPredicateMatches("27", "27101")).toBe(false);
    expect(new RegExp(clause.spaceCd.$regex, "i").test("27101")).toBe(true);
  });

  it("ranks an exact code above a prefix match", () => {
    // Act & Assert
    expect(scoreLocally(SPACE_TIERS, "27101", engineering)).toBe(60);
    expect(scoreLocally(SPACE_TIERS, "2710", engineering)).toBe(50);
  });
});

describe("room reachability (q=204) — rooms in a digit-free building", () => {
  // The Law building's name contains no digits, so 20401 is reachable ONLY via its own code.
  const law = room("20401", "법학전문대학원열람실", "법학관");

  it("finds the room by a prefix of its code", () => {
    // Act & Assert
    expect(scoreLocally(SPACE_TIERS, "204", law)).toBe(50);
  });

  it("matches the room through the keyword filter (it did not before)", () => {
    // Act
    const or = spaceKeywordFilter("204").$or as Document[];
    const spaceCdClause = or.find((c) => "spaceCd" in c);

    // Assert
    // The bug was `{ spaceCd: "204" }` — an equality that 20401 never satisfies.
    expect(spaceCdClause).toEqual({
      spaceCd: { $regex: "204", $options: "i" },
    });
  });
});

describe("scoring edge cases from real production rows", () => {
  it("does not throw on spaceCd: null and still scores via name", () => {
    // Arrange
    // Two such rows exist: the 600th Anniversary Hall (buildNo 101) and the Medicine building (buildNo 271).
    const orphan = room(null, "숙실(271)", "기숙사신관");

    // Act & Assert
    expect(() => scoreLocally(SPACE_TIERS, "27", orphan)).not.toThrow();
    expect(scoreLocally(SPACE_TIERS, "27", orphan)).toBe(5);
  });

  it("treats a non-string spaceCd as empty rather than matching it", () => {
    // Arrange
    // If SKKU ever emits `"spaceCd": 27101` as a JSON number, sync passes it
    // straight through. The Mongo guard coerces it to "" ($regexMatch would
    // otherwise throw and 500 every request); readPath must agree, or the JS
    // twin would silently score a row the pipeline scores differently.
    const numeric = room(27101, "측량기기성능검사실", "제2공학관27동");
    const stringy = room("27101", "측량기기성능검사실", "제2공학관27동");

    // Act & Assert
    expect(() => scoreLocally(SPACE_TIERS, "27", numeric)).not.toThrow();
    // Falls back to the buildingName SUBSTRING tier (10) — the wing 27 building's name does
    // not start with "27" — instead of the spaceCd prefix tier (50) it would
    // have earned as a string. Demoted, never crashing.
    expect(scoreLocally(SPACE_TIERS, "27", numeric)).toBe(10);
    expect(scoreLocally(SPACE_TIERS, "27", stringy)).toBe(50);
  });

  it("matches the single lowercase spaceCd case-insensitively", () => {
    // Arrange
    const med = room("712115b", "의학교육연구실", "의학관");

    // Act & Assert
    expect(scoreLocally(SPACE_TIERS, "712115b", med)).toBe(60);
    expect(scoreLocally(SPACE_TIERS, "712115B", med)).toBe(60);
  });

  it("treats regex metacharacters literally", () => {
    // Arrange
    const dotted = room("a.b", "x", "y");
    const literal = room("axb", "x", "y");

    // Act & Assert
    expect(scoreLocally(SPACE_TIERS, "a.b", dotted)).toBe(60);
    expect(scoreLocally(SPACE_TIERS, "a.b", literal)).toBe(0);
  });
});

describe("building tiers", () => {
  const b = (displayNo: string, nameKo: string, descKo = "") => ({
    displayNo,
    name: { ko: nameKo, en: "" },
    description: { ko: descKo, en: "" },
  });

  it("ranks exact displayNo above prefix above name above description", () => {
    // Act & Assert
    expect(scoreLocally(BUILDING_TIERS, "27", b("27", "제2공학관27동"))).toBe(50);
    expect(scoreLocally(BUILDING_TIERS, "2", b("27", "제2공학관27동"))).toBe(40);
    expect(scoreLocally(BUILDING_TIERS, "법학", b("2", "법학관"))).toBe(30);
    expect(
      scoreLocally(BUILDING_TIERS, "1999", b("1", "600주년기념관", "1999년 완공")),
    ).toBe(10);
  });

  it("never matches buildNo — 27 must not surface 270/271/272", () => {
    // Act
    const or = buildingKeywordFilter("27").$or as Document[];

    // Assert
    expect(or.some((c) => "buildNo" in c)).toBe(false);
    expect(or).toContainEqual({
      displayNo: { $regex: "^27", $options: "i" },
    });
  });
});

describe("row caps", () => {
  it("sizes the strong cap above the largest building and cuts the weak tail", () => {
    // Assert
    // The new dormitory (buildNo 298) holds 801 rooms — the strong band must never
    // truncate a building. The weak band is what keeps `q=실` (6173 matches) from
    // reaching a non-virtualized ScrollView.
    expect(SPACE_SEARCH_LIMIT).toBeGreaterThan(801);
    expect(SPACE_WEAK_LIMIT).toBeLessThanOrEqual(100);
    expect(BUILDING_SEARCH_LIMIT).toBeGreaterThan(78);
    // The strong cut must land on the spaceCd-prefix tier.
    expect(SPACE_STRONG_MIN_SCORE).toBe(50);
  });
});
