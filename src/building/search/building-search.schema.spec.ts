import { buildingSearchQuery } from "./building-search.schema";

describe("building search schema", () => {
  it("trims q, rejects a blank one, and reads campus like the list", () => {
    expect(buildingSearchQuery.parse({ q: "  도서 " })).toEqual({ q: "도서", campus: undefined });
    expect(buildingSearchQuery.safeParse({ q: "   " }).success).toBe(false);
    // A repeated q used to reach .trim() on an array and answer 500; it is now
    // a 400 MISSING_QUERY like any other unusable q.
    expect(buildingSearchQuery.safeParse({ q: ["a", "b"] }).success).toBe(false);
  });
});
