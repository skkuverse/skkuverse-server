/**
 * The baseline rules: toTmapOffsets reads the travel time to each stop from a
 * TMAP prediction (a synthetic response shaped after the live probe of
 * 2026-10-09; TMAP's terms forbid keeping real responses past 24 h), ignoring
 * the waypoint echo after E, and rejects the cases of spec "Implausible routes
 * are rejected"; refreshCutoff is the latest 04:00 KST at or before now.
 */
import fs from "fs";
import path from "path";
import moment from "moment-timezone";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { baselineDoc } from "../bus-eta.mapper";
import { refreshCutoff, toTmapOffsets } from "./bus-eta-baseline.rules";
import type { TmapPredictionResponse } from "./bus-eta-baseline.types";



const kst = (date: string, hhmm: string) => moment.tz(`${date} ${hhmm}`, "YYYY-MM-DD HH:mm", "Asia/Seoul").toDate();

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

  it("Prediction expires after 24 hours: a baseline from it is a TMAP value that lives 24 h", () => {
    // Arrange
    const fetchedAt = new Date("2026-10-11T19:00:00Z"); // 04:00 KST
    const run = {
      serviceId: "campus-inja",
      routeType: "regular",
      date: "2026-10-12",
      time: "10:00",
      departAt: new Date("2026-10-12T01:00:00Z"),
    };

    // Act
    const doc = baselineDoc(run, toTmapOffsets(fixture(), STOPS), fetchedAt);

    // Assert
    expect(doc).toMatchObject({ source: "tmap", kind: "baseline", offsetsSec: OFFSETS });
    expect(doc.expiresAt.getTime() - fetchedAt.getTime()).toBe(24 * 3600_000);
  });
});

describe("refreshCutoff", () => {
  it("is the latest 04:00 KST at or before now", () => {
    // Act & Assert
    expect(refreshCutoff(kst("2026-10-12", "03:59"))).toEqual(kst("2026-10-11", "04:00"));
    expect(refreshCutoff(kst("2026-10-12", "04:00"))).toEqual(kst("2026-10-12", "04:00"));
    expect(refreshCutoff(kst("2026-10-12", "23:30"))).toEqual(kst("2026-10-12", "04:00"));
  });
});

