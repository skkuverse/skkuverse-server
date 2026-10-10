import { buildingListQuery, skkuIdParam } from "./building.schema";

describe("building schemas", () => {
  it("read campus as optional, an empty value as absent", () => {
    expect(buildingListQuery.parse({})).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "" })).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "nsc", other: "x" })).toEqual({ campus: "nsc" });
    expect(buildingListQuery.safeParse({ campus: ["hssc", "nsc"] }).success).toBe(false);
  });

  it.each([
    ["1", 1],
    ["12abc", 12],
    ["1.9", 1],
    [" 7", 7],
  ])("read skkuId %j with parseInt as %d", (raw, id) => {
    expect(skkuIdParam.parse(raw)).toBe(id);
  });

  it("pass an id too long for a double as Infinity, which then finds nothing", () => {
    expect(skkuIdParam.parse("9".repeat(400))).toBe(Infinity);
  });

  it.each(["0", "-3", "abc", "", "0x10"])("reject skkuId %j", (raw) => {
    const result = skkuIdParam.safeParse(raw);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("skkuId must be a positive integer");
  });
});
