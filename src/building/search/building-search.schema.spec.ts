/**
 * GET /building/search's query schema: q is trimmed and a blank or repeated q is
 * rejected (the 400 MISSING_QUERY), and campus is read like the list's.
 */
import { buildingSearchQuery } from "./building-search.schema";

describe("building search schema", () => {
  it("trims q, rejects a blank one, and reads campus like the list", () => {
    // Act & Assert
    expect(buildingSearchQuery.parse({ q: "  도서 " })).toEqual({ q: "도서", campus: undefined });
    expect(buildingSearchQuery.safeParse({ q: "   " }).success).toBe(false);
    // A repeated q arrives as an array; it must be a 400 MISSING_QUERY, not reach
    // .trim() and answer 500.
    expect(buildingSearchQuery.safeParse({ q: ["a", "b"] }).success).toBe(false);
  });
});
