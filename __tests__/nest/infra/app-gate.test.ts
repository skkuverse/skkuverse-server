/**
 * scripts/lib/app-gate.js, the comparison behind `npm run app-gate:check`: the
 * App Store's live iOS listing against the `ios` gate /app/config serves. It
 * fails when the store build is older than `minVersion` (a gated user could not
 * update), when the store's minimum OS differs from `minOsVersion` (the gate
 * would trap or wrongly free users), and when any field is missing.
 */
// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { compareVersions, iosGateProblems } = require("../../../scripts/lib/app-gate");

const STORE = { version: "3.6.2", minimumOsVersion: "16.4" };
const SERVED = { minVersion: "3.5.0", minOsVersion: "16.4" };

describe("compareVersions", () => {
  it.each([
    ["3.6.2", "3.6.2", 0],
    ["3.6.2", "3.6.10", -1],
    ["3.10.0", "3.9.9", 1],
    ["16.4", "16.4.0", 0],
    ["16.4", "16.3.9", 1],
    ["15", "15.1", -1],
  ])("compares %s with %s as %i", (a, b, expected) => {
    // Act & Assert
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe("iosGateProblems", () => {
  it("passes a store build at or above minVersion whose minimum OS equals minOsVersion", () => {
    // Act & Assert
    expect(iosGateProblems(STORE, SERVED)).toEqual([]);
    expect(iosGateProblems(STORE, { ...SERVED, minVersion: "3.6.2" })).toEqual([]);
  });

  it("fails a store build below the served minVersion", () => {
    // Act
    const problems = iosGateProblems(STORE, { ...SERVED, minVersion: "3.6.3" });

    // Assert
    expect(problems).toEqual([expect.stringMatching(/^App Store version 3\.6\.2 is below the served ios\.minVersion 3\.6\.3/)]);
  });

  it.each(["16.3", "17.0", "15.1"])("fails a served minOsVersion of %s against the store's 16.4, printing both", (minOsVersion) => {
    // Act
    const problems = iosGateProblems(STORE, { ...SERVED, minOsVersion });

    // Assert
    expect(problems).toEqual([`App Store minimumOsVersion 16.4 differs from the served ios.minOsVersion ${minOsVersion}`]);
  });

  it("treats 16.4 and 16.4.0 as the same minimum OS", () => {
    // Act & Assert
    expect(iosGateProblems({ ...STORE, minimumOsVersion: "16.4.0" }, SERVED)).toEqual([]);
  });

  it.each([
    ["no store result", undefined, SERVED, "App Store version"],
    ["a store result without minimumOsVersion", { version: "3.6.2" }, SERVED, "App Store minimumOsVersion"],
    ["a served gate without minOsVersion", STORE, { minVersion: "3.5.0" }, "served ios.minOsVersion"],
    ["no served gate", STORE, undefined, "served ios.minVersion"],
  ])("fails %s, naming the missing field", (_label, store, served, field) => {
    // Act
    const problems = iosGateProblems(store, served);

    // Assert
    expect(problems).toContainEqual(expect.stringContaining(`${field} is missing`));
  });
});
