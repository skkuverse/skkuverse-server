/**
 * The accuracy history's decisions: a horizon is
 * recorded on the tick the served lead time first falls to or below it, never
 * for a train first seen inside it; an observed arrival is an arrived row at its
 * time or an approaching row 30 s on (the approach lead), never a
 * departure; the error is the predicted instant minus the observed one; and a
 * record is unresolved once its predicted arrival is 30 minutes past. A record
 * is written open, and only a row first seen at a later tick than the one that
 * made it resolves it, never the row it was predicted from (F6), within those
 * 30 minutes; an arrived row also replaces an approaching row's resolution.
 */
import { isResolvableBy, toCrossedHorizons, toErrorSec, toObservedArrivalAt, toPredictionDoc, toUnresolvedCutoff } from "./subway-history.rules";
import type { PredictionMade } from "./subway-history.types";

const MIN = 60_000;
const at = (kst: string): Date => new Date(`2026-10-16T${kst}+09:00`);

describe("toCrossedHorizons", () => {
  it.each([
    ["5 min 20 s to 4 min 50 s", 320_000, 290_000, [5]],
    ["one above to exactly 5 min", 5 * MIN + 1, 5 * MIN, [5]],
    ["exactly 5 min to just below", 5 * MIN, 5 * MIN - 1, []],
    ["just above 10 min to just above 5 min", 10 * MIN + 1, 5 * MIN + 1, [10]],
    ["11 min to 2 min, past 10, 5 and 3 in one tick", 11 * MIN, 2 * MIN, [10, 5, 3]],
    ["61 s to 0", 61_000, 0, [1]],
    ["a lead that grew, 4 to 6 min", 4 * MIN, 6 * MIN, []],
    ["a train first seen 2 min out", undefined, 2 * MIN, []],
    ["a train first seen 12 min out", undefined, 12 * MIN, []],
  ])("records the horizons crossed from %s", (_label, previousLeadMs, leadMs, horizons) => {
    // Act & Assert
    expect(toCrossedHorizons(previousLeadMs, leadMs)).toEqual(horizons);
  });

  it("gives a train first seen 2 min out only its 1-minute horizon over the following ticks", () => {
    // Arrange
    const leads = [120_000, 90_000, 61_000, 59_000, 30_000];

    // Act
    const crossed = leads.flatMap((leadMs, index) => toCrossedHorizons(index === 0 ? undefined : leads[index - 1], leadMs));

    // Assert
    expect(crossed).toEqual([1]);
  });
});

describe("toObservedArrivalAt", () => {
  it.each([
    ["arrived", "21:05:50", at("21:05:50")],
    ["approaching", "21:05:20", at("21:05:50")],
    ["departed", "21:06:20", null],
  ] as const)("reads a %s row at %s", (state, kst, observedAt) => {
    // Act & Assert
    expect(toObservedArrivalAt({ state, stateChangedAt: at(kst) })).toEqual(observedAt);
  });
});

describe("toErrorSec", () => {
  it.each([
    ["predicted 21:05:30, observed 21:05:50", at("21:05:30"), at("21:05:50"), -20],
    ["predicted 21:06:10, observed 21:05:50", at("21:06:10"), at("21:05:50"), 20],
    ["on time", at("21:05:50"), at("21:05:50"), 0],
    ["a crawl time 250 ms past the second", at("21:05:30"), new Date(at("21:05:50").getTime() + 250), -20.25],
  ])("is the error for %s", (_label, predictedAt, observedAt, errorSec) => {
    // Act & Assert
    expect(toErrorSec(predictedAt, observedAt)).toBe(errorSec);
  });
});

describe("toUnresolvedCutoff", () => {
  it("leaves open a record predicted for exactly 30 minutes ago and marks one predicted a millisecond earlier", () => {
    // Act
    const cutoff = toUnresolvedCutoff(at("21:35:30"));

    // Assert
    expect(cutoff).toEqual(at("21:05:30"));
    expect(new Date(at("21:05:30").getTime() - 1) < cutoff).toBe(true);
  });
});

describe("toPredictionDoc", () => {
  const made: PredictionMade = {
    serviceDate: "2026-10-16",
    platformId: "KR-1-P153",
    direction: "up",
    horizonMin: 3,
    train: { trainNo: "0692", destination: "광운대", express: false, arrivalAt: at("21:05:30"), source: "estimated", isFirstTrain: false, position: null },
    madeAt: at("21:02:31"),
  };

  it("writes the prediction served then, open", () => {
    // Act & Assert
    expect(toPredictionDoc(made)).toEqual({
      serviceDate: "2026-10-16",
      trainNo: "0692",
      stationId: "KR-1-P153",
      horizonMin: 3,
      direction: "up",
      source: "estimated",
      predictedAt: at("21:05:30"),
      madeAt: at("21:02:31"),
      status: "open",
      observedAt: null,
      observedState: null,
      resolvedAt: null,
      errorSec: null,
    });
  });
});

describe("isResolvableBy", () => {
  const seenAt = at("20:31:10");
  const open = { status: "open", observedState: null, madeAt: at("20:28:40"), predictedAt: at("20:31:30") } as const;
  const approachResolved = { ...open, status: "resolved", observedState: "approaching" } as const;
  const arrivedResolved = { ...open, status: "resolved", observedState: "arrived" } as const;
  const unresolved = { ...open, status: "unresolved" } as const;
  const madeAt = (instant: Date) => ({ ...open, madeAt: instant });
  const predictedAt = (instant: Date) => ({ ...open, predictedAt: instant });
  const ms = (instant: Date, deltaMs: number): Date => new Date(instant.getTime() + deltaMs);

  it.each([
    ["an open record made a millisecond before the tick that first saw the row", true, "arrived", madeAt(ms(seenAt, -1))],
    ["an open record made at the tick that first saw the row (F6: the row it was made from)", false, "arrived", madeAt(seenAt)],
    ["an open record made a millisecond after that tick", false, "arrived", madeAt(ms(seenAt, 1))],
    ["an open record and an approaching row", true, "approaching", open],
    ["an open record made at the tick that first saw an approaching row", false, "approaching", madeAt(seenAt)],
    ["a record an approaching row resolved, and an arrived row", true, "arrived", approachResolved],
    ["a record an approaching row resolved, and another approaching row", false, "approaching", approachResolved],
    ["a record an arrived row resolved, and another arrived row", false, "arrived", arrivedResolved],
    ["an unresolved record", false, "arrived", unresolved],
    ["a record predicted exactly 30 minutes before the tick", true, "arrived", predictedAt(ms(seenAt, -30 * MIN))],
    ["a record predicted 30 minutes and a millisecond before the tick", false, "arrived", predictedAt(ms(seenAt, -30 * MIN - 1))],
  ] as const)("%s: resolvable %s", (_label, isResolvable, observedState, record) => {
    // Act & Assert
    expect(isResolvableBy(record, { observedState }, seenAt)).toBe(isResolvable);
  });
});
