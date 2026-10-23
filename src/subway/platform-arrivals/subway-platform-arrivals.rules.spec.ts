/**
 * Which stored state a platform is served from: the tracker's stored state is
 * fresh while it is at most 2 minutes old, and older it means the tracker has
 * stopped writing.
 */
import { isFreshState } from "./subway-platform-arrivals.rules";

const GENERATED_AT = new Date("2026-10-16T11:41:00Z");

describe("isFreshState", () => {
  it.each([
    ["119 s", "2026-10-16T11:42:59Z", true],
    ["120 s", "2026-10-16T11:43:00Z", true],
    ["121 s", "2026-10-16T11:43:01Z", false],
  ])("reads a state generated %s ago as fresh: %s", (_label, nowIso, fresh) => {
    // Act
    const isFresh = isFreshState(GENERATED_AT, new Date(nowIso));

    // Assert
    expect(isFresh).toBe(fresh);
  });
});
