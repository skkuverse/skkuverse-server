import { buildingListQuery, buildingSearchQuery, skkuIdParam } from "./building.schema";

describe("building schemas", () => {
  it("read campus as optional, an empty value as absent", () => {
    expect(buildingListQuery.parse({})).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "" })).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "nsc", other: "x" })).toEqual({ campus: "nsc" });
    expect(buildingListQuery.safeParse({ campus: ["hssc", "nsc"] }).success).toBe(false);
  });

  it("trim q and reject a blank one", () => {
    expect(buildingSearchQuery.parse({ q: "  도서 " })).toEqual({ q: "도서", campus: undefined });
    expect(buildingSearchQuery.safeParse({ q: "   " }).success).toBe(false);
    // A repeated q used to reach .trim() on an array and answer 500; it is now
    // a 400 MISSING_QUERY like any other unusable q.
    expect(buildingSearchQuery.safeParse({ q: ["a", "b"] }).success).toBe(false);
  });

  it.each([
    ["1", 1],
    ["12abc", 12],
    ["1.9", 1],
    [" 7", 7],
  ])("read skkuId %j with parseInt as %d", (raw, id) => {
    expect(skkuIdParam.parse(raw)).toBe(id);
  });

  it.each(["0", "-3", "abc", "", "0x10"])("reject skkuId %j", (raw) => {
    const result = skkuIdParam.safeParse(raw);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("skkuId must be a positive integer");
  });
});
