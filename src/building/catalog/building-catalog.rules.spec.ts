/**
 * floorSortKey: SKKU's Korean floor names in building order, basement first and
 * rooftop last, and every name it does not recognize (including "") after all
 * of them.
 */
import { floorSortKey } from "./building-catalog.rules";

describe("floorSortKey", () => {
  it.each([
    ["지하2층", -2],
    ["지하1층", -1],
    ["1층", 1],
    ["10층", 10],
    ["옥탑1층", 1001],
    ["옥탑2층", 1002],
  ])("ranks %s at %d", (floorKo, key) => {
    // Act & Assert
    expect(floorSortKey(floorKo)).toBe(key);
  });

  it.each(["", "로비", "1 층", "B1", "지하층", "1층 일부"])("sorts the unrecognized %j last", (floorKo) => {
    // Act & Assert
    expect(floorSortKey(floorKo)).toBe(Infinity);
  });
});
