/**
 * The accuracy history's decisions (subway-arrival-accuracy spec): a horizon is
 * recorded on the tick the served lead time first falls to or below it, never
 * for a train first seen inside it; an observed arrival is an arrived row at its
 * time or an approaching row 30 s on (design D4's approach lead), never a
 * departure; the error is the predicted instant minus the observed one; and a
 * record is unresolved once its predicted arrival is 30 minutes past; a record
 * is open until its train is observed, and resolved from the start after.
 */
import { toCrossedHorizons, toErrorSec, toObservedArrivalAt, toPredictionDoc, toUnresolvedCutoff } from "./subway-history.rules";
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
    stationId: "KR-1-0153",
    direction: "up",
    horizonMin: 3,
    train: { trainNo: "0692", destination: "광운대", express: false, arrivalAt: at("21:05:30"), source: "estimated", position: null },
    madeAt: at("21:02:31"),
  };

  it("writes the prediction served then, open while the train has not been observed", () => {
    // Act & Assert
    expect(toPredictionDoc(made, undefined)).toEqual({
      serviceDate: "2026-10-16",
      trainNo: "0692",
      stationId: "KR-1-0153",
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

  it("writes it resolved, with its error, when the train's arrival was already observed", () => {
    // Arrange
    const observed = { serviceDate: "2026-10-16", trainNo: "0692", stationId: "KR-1-0153", observedAt: at("21:05:50"), observedState: "arrived" as const };

    // Act & Assert
    expect(toPredictionDoc(made, observed)).toMatchObject({
      status: "resolved",
      observedAt: at("21:05:50"),
      observedState: "arrived",
      resolvedAt: at("21:02:31"),
      errorSec: -20,
    });
  });
});
