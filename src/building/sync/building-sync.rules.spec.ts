/**
 * shouldFailBuildInfoPhase: when phase 2's buildInfo failures say SKKU is
 * broken, not one building. More than half of the attempted buildings failing
 * trips it; exactly half does not, and a run that attempted nothing never
 * fails.
 */
import { shouldFailBuildInfoPhase } from "./building-sync.rules";

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
