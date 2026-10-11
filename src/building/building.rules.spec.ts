/**
 * The building rules every sub-module shares: which values are campuses, which
 * buildings are facilities, the building number users see (buildNo without its
 * campus digit), and the one minter of each building brand: a skkuId is a
 * positive safe integer that every production id passes, apiId is the same
 * number, and buildNo and spaceCd are any non-empty string.
 */
import type { BuildNo, SkkuId } from "./building.types";
import { hasBuildNo, isBuildNo, isCampus, isSkkuId, isSpaceCd, toApiId, toDisplayNo } from "./building.rules";

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

describe("building brand minters", () => {
  it.each([1, 88, Number.MAX_SAFE_INTEGER])("isSkkuId accepts %p", (id) => {
    // Act & Assert
    expect(isSkkuId(id)).toBe(true);
  });

  it("isSkkuId accepts every production id, 1 to 88", () => {
    // Arrange
    // A business rule such as "at least 100" in the minter would reject them all and stop the sync (design D3).
    const productionIds = Array.from({ length: 88 }, (_, i) => i + 1);

    // Act
    const rejected = productionIds.filter((id) => !isSkkuId(id));

    // Assert
    expect(rejected).toEqual([]);
  });

  it.each([0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("isSkkuId rejects %p", (id) => {
    // Act & Assert
    expect(isSkkuId(id)).toBe(false);
  });

  it.each([
    ["", false],
    ["1", true],
    ["227", true],
    ["248101", true],
  ])("isBuildNo(%j) → %s", (buildNo, expected) => {
    // Act & Assert
    expect(isBuildNo(buildNo)).toBe(expected);
  });

  it.each([
    ["", false],
    ["1", true],
    ["227", true],
    ["248101", true],
  ])("isSpaceCd(%j) → %s", (spaceCd, expected) => {
    // Act & Assert
    expect(isSpaceCd(spaceCd)).toBe(expected);
  });

  it.each([1, 88, Number.MAX_SAFE_INTEGER])("toApiId(%p) is the same number", (id) => {
    // Act & Assert
    expect(toApiId(id as SkkuId)).toBe(id);
  });
});
