/**
 * The building rules every sub-module shares: which values are campuses, which
 * buildings are facilities, and the building number users see (buildNo without
 * its campus digit).
 */
import type { BuildNo } from "./building.types";
import { hasBuildNo, isCampus, toDisplayNo } from "./building.rules";

describe("isCampus", () => {
  it.each([
    ["hssc", true],
    ["nsc", true],
    ["HSSC", false],
    ["", false],
    [null, false],
    [undefined, false],
    [1, false],
  ])("%j → %s", (value, expected) => {
    // Act & Assert
    expect(isCampus(value)).toBe(expected);
  });
});

describe("hasBuildNo", () => {
  it.each([
    ["227", true],
    ["", false],
    [null, false],
  ])("buildNo %j → %s", (buildNo, expected) => {
    // Act & Assert
    expect(hasBuildNo({ buildNo: buildNo as BuildNo | null })).toBe(expected);
  });
});

describe("toDisplayNo", () => {
  it.each([
    ["227", "nsc", "27"],
    ["2027", "nsc", "27"],
    ["102", "hssc", "2"],
    ["100", "hssc", "0"],
    ["1", "hssc", "0"],
    ["227", "hssc", "227"],
    ["E01", "nsc", "E01"],
  ] as const)("shows buildNo %s on %s as %s", (buildNo, campus, displayNo) => {
    // Act & Assert
    expect(toDisplayNo(buildNo as BuildNo, campus)).toBe(displayNo);
  });

  it("has no display number without a buildNo", () => {
    // Act & Assert
    expect(toDisplayNo(null, "nsc")).toBeNull();
  });
});
