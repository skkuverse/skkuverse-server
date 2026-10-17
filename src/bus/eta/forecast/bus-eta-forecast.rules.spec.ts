/**
 * The forecast rules: toTmapOffsets reads the travel time to each stop from a
 * TMAP prediction (a synthetic response shaped after the live probe of
 * 2026-10-09; TMAP's terms forbid keeping real responses past 24 h), ignoring
 * the waypoint echo after E, and rejects the cases of spec "Implausible routes
 * are rejected". reusableFixedDates and toReusableFixedByRun choose the fixed
 * value a bus-lane run's prediction reuses: the latest of the same service,
 * route type, KST weekday and departure time (design D7).
 */
import fs from "fs";
import path from "path";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { FixedEstimate } from "../bus-eta.document";
import { reusableFixedDates, toReusableFixedByRun, toTmapOffsets } from "./bus-eta-forecast.rules";
import type { TmapPredictionResponse } from "./bus-eta-forecast.types";

const FIXTURE: TmapPredictionResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/tmap-prediction-inja.json"), "utf8"),
);
// Student center bus lot → N Center → Welfare Hall
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];
const OFFSETS = [0, 4500, 4620];

const fixture = (): TmapPredictionResponse => JSON.parse(JSON.stringify(FIXTURE));
const features = (res: TmapPredictionResponse) => res.features!;

function rejection(fn: () => unknown): BusEtaDirectionsError {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(BusEtaDirectionsError);
    return err as BusEtaDirectionsError;
  }
  throw new Error("expected a BusEtaDirectionsError");
}

describe("toTmapOffsets", () => {
  it("reads the travel time to each stop from the running segment times, ignoring the waypoint echo after E", () => {
    // Act & Assert
    expect(features(fixture()).at(-1)!.properties).toEqual({ name: "", pointType: "B1" });
    expect(toTmapOffsets(fixture(), STOPS)).toEqual(OFFSETS);
  });

  it("rejects a wrong count of waypoint (B1…) points", () => {
    // Arrange
    const res = fixture();
    res.features = features(res).filter((f) => !(f.properties.pointType === "B1" && f.properties.index !== undefined));

    // Act
    const err = rejection(() => toTmapOffsets(res, STOPS));

    // Assert
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/expected 1 waypoint \(B1…\) and 1 end \(E\) points, got 0 and 1/);
  });

  it("rejects a route without an end (E) point", () => {
    // Arrange
    const res = fixture();
    res.features = features(res).filter((f) => f.properties.pointType !== "E");

    // Act & Assert
    expect(rejection(() => toTmapOffsets(res, STOPS)).message).toMatch(/got 1 and 0/);
  });

  it("rejects stop times that miss the route total by more than 30 s", () => {
    // Arrange
    const res = fixture();
    features(res)[0]!.properties.totalTime = 4620 + 31;

    // Act & Assert
    expect(rejection(() => toTmapOffsets(res, STOPS)).message).toMatch(/add up to 4620 s but the route total is 4651 s/);
    const close = fixture();
    features(close)[0]!.properties.totalTime = 4620 + 29;
    expect(toTmapOffsets(close, STOPS)).toEqual(OFFSETS);
  });

  it("Drop-off snapped to an outside road: rejects a stop more than 150 m from where the route places it", () => {
    // Arrange
    const moved = [...STOPS];
    moved[1] = { lat: 37.292298 - 0.00225, lng: 126.975057 }; // about 250 m south

    // Act
    const err = rejection(() => toTmapOffsets(fixture(), moved));

    // Assert
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/stop 1 is 2\d\d m from where the route places it/);
  });

  it("rejects offsets that go backwards", () => {
    // Arrange
    const res = fixture();
    const last = features(res).findIndex((f) => f.properties.pointType === "E") - 1;
    features(res)[last]!.properties.time = -300;
    features(res)[0]!.properties.totalTime = 4200;

    // Act & Assert
    expect(rejection(() => toTmapOffsets(res, STOPS)).message).toMatch(/stop 2 is reached before stop 1/);
  });

  it("reports a response without a route as an API failure", () => {
    // Act
    const err = rejection(() => toTmapOffsets({ type: "FeatureCollection", features: [] }, STOPS));

    // Assert
    expect(err.kind).toBe("api");
    expect(err.retryable).toBe(false);
  });
});

describe("reusableFixedDates", () => {
  it.each([
    ["the run is today: the two weeks before it", "2026-10-20", ["2026-10-13", "2026-10-06"]],
    ["the run is in 6 days: its weekday's last two dates before today", "2026-10-26", ["2026-10-19", "2026-10-12"]],
    ["the run is in 7 days: today, whose run may already be fixed, then a week earlier", "2026-10-27", ["2026-10-20", "2026-10-13"]],
    ["the run is in 8 days", "2026-10-28", ["2026-10-14", "2026-10-07"]],
  ])("%s", (_case, runDate, expected) => {
    // Act
    const dates = reusableFixedDates(runDate, "2026-10-20");

    // Assert
    expect(dates).toEqual(expected);
  });
});

describe("toReusableFixedByRun", () => {
  const TODAY = "2026-10-20";
  // Next Tuesday's 13:30 regular run.
  const RUN = { serviceId: "campus-inja", routeType: "regular", date: "2026-10-27", time: "13:30", departAt: new Date("2026-10-27T04:30:00.000Z") };
  const fixed = (date: string, overrides: Partial<FixedEstimate> = {}): FixedEstimate => ({
    _id: `campus-inja|regular|${date}|13:30|live`,
    serviceId: "campus-inja",
    routeType: "regular",
    date,
    time: "13:30",
    offsetsSec: [0, 4320],
    ...overrides,
  });

  it("gives a run the latest of its weekday's two fixed values, keyed by its prediction's id", () => {
    // Arrange
    const thisWeek = fixed("2026-10-20", { offsetsSec: [0, 4320] });
    const lastWeek = fixed("2026-10-13", { offsetsSec: [0, 5040] });

    // Act
    const byRun = toReusableFixedByRun([RUN], [lastWeek, thisWeek], TODAY);

    // Assert
    expect([...byRun]).toEqual([["campus-inja|regular|2026-10-27|13:30|baseline", thisWeek]]);
  });

  it("falls back to the week before when this week's run was not fixed", () => {
    // Arrange
    const lastWeek = fixed("2026-10-13");

    // Act
    const byRun = toReusableFixedByRun([RUN], [lastWeek], TODAY);

    // Assert
    expect(byRun.get("campus-inja|regular|2026-10-27|13:30|baseline")).toBe(lastWeek);
  });

  it.each([
    ["another weekday", fixed("2026-10-19", { _id: "monday" })],
    ["another departure time", fixed("2026-10-20", { time: "14:00" })],
    ["another route type", fixed("2026-10-20", { routeType: "hakbu" })],
    ["another service", fixed("2026-10-20", { serviceId: "campus-jain" })],
    ["a date after the run", fixed("2026-11-03")],
  ])("gives nothing for a fixed value of %s", (_case, other) => {
    // Act
    const byRun = toReusableFixedByRun([RUN], [other], TODAY);

    // Assert
    expect(byRun.size).toBe(0);
  });
});
