/**
 * shouldFailBuildInfoPhase: when phase 2's buildInfo failures say SKKU is
 * broken, not one building. More than half of the attempted buildings failing
 * trips it; exactly half does not, and a run that attempted nothing never
 * fails. Also needsEnrichment (which listed buildings phase 1 re-enriches) and
 * toSyncError (the run's one rejection), and shouldRejectPayload (when a SKKU
 * list has too many invalid items to trust, on the same boundary as phase 2).
 */
import { needsEnrichment, shouldFailBuildInfoPhase, shouldRejectPayload, toSyncError } from "./building-sync.rules";

describe("shouldFailBuildInfoPhase", () => {
  it.each([
    [59, 59, true],
    [1, 1, true],
    [30, 59, true],
    [6, 10, true],
    [29, 59, false],
    [5, 10, false],
    [1, 59, false],
    [0, 59, false],
    [0, 0, false],
  ])("is %s-of-%s failed → %s", (failed, attempted, expected) => {
    // Act & Assert
    expect(shouldFailBuildInfoPhase({ attempted, failed })).toBe(expected);
  });
});

describe("needsEnrichment", () => {
  it.each([
    ["a building never seen before", true, undefined, "2026-09-01", false],
    ["a building SKKU changed", true, "2026-08-01", "2026-09-01", false],
    ["a building whose update stamp SKKU dropped", true, "2026-08-01", null, false],
    ["an unchanged building enriched at an older version", true, "2026-09-01", "2026-09-01", true],
    ["an unchanged building at the current version", false, "2026-09-01", "2026-09-01", false],
    ["an unchanged building SKKU never stamped", false, null, null, false],
  ])("for %s → %s", (_case, expected, knownUpdatedAt, listedUpdatedAt, isEnrichedAtOldVersion) => {
    // Act & Assert
    expect(needsEnrichment({ knownUpdatedAt, listedUpdatedAt, isEnrichedAtOldVersion })).toBe(expected);
  });
});

describe("toSyncError", () => {
  it("names each failed phase in order and keeps the original errors", () => {
    // Arrange
    const buildInfoError = new Error("buildInfo failed for 60 of 60 buildings");
    const spaceListError = new Error("socket hang up");

    // Act
    const error = toSyncError([
      { phase: "phase 2 (buildInfo)", err: buildInfoError },
      { phase: "phase 3 (spaceList)", err: spaceListError },
    ]);

    // Assert
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe("Building sync failed in phase 2 (buildInfo) and phase 3 (spaceList)");
    expect(error.errors).toEqual([buildInfoError, spaceListError]);
  });
});

describe("shouldRejectPayload", () => {
  it.each([
    [1, 1, true],
    [2050, 2050, true],
    [1026, 2050, true],
    [6, 10, true],
    [1025, 2050, false],
    [5, 10, false],
    [1, 2050, false],
    [1, 5591, false],
    [0, 25, false],
    [0, 0, false],
  ])("is %s-of-%s invalid → %s", (invalid, total, expected) => {
    // Act & Assert
    expect(shouldRejectPayload({ total, invalid })).toBe(expected);
  });
});
