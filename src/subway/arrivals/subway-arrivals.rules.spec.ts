/**
 * The arrivals route's two decisions: the stored state is served while it is
 * at most 2 minutes old, and a train's remaining seconds count from the
 * state's `generatedAt` to its arrival, whole seconds, never below zero (a
 * train already standing at the station).
 */
import { isFreshState, toRemainingSec } from "./subway-arrivals.rules";

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

describe("toRemainingSec", () => {
  it.each([
    ["110 s after", "2026-10-16T11:42:50Z", 110],
    ["0.4 s after", "2026-10-16T11:41:00.400Z", 0],
    ["0.6 s after", "2026-10-16T11:41:00.600Z", 1],
    ["at", "2026-10-16T11:41:00Z", 0],
    ["30 s before", "2026-10-16T11:40:30Z", 0],
  ])("counts an arrival %s generatedAt as %i s", (_label, arrivalIso, remainingSec) => {
    // Act
    const seconds = toRemainingSec(new Date(arrivalIso), GENERATED_AT);

    // Assert
    expect(seconds).toBe(remainingSec);
  });
});
