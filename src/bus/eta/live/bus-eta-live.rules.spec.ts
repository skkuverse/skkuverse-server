/**
 * toNaverOffsets reads the travel time to each stop from a NAVER Directions 5
 * response, over the live response captured on 2026-10-09 (tasks.md 9.1) for
 * campus-inja.regular, and rejects the cases of spec "Implausible routes are
 * rejected".
 */
import fs from "fs";
import path from "path";
import { DirectionsError } from "../../../shared/directions.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { toNaverOffsets } from "./bus-eta-live.rules";
import type { NaverDirectionsResponse } from "./bus-eta-live.types";


const FIXTURE: NaverDirectionsResponse = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/naver-directions-inja.json"), "utf8"),
);
// Student center bus lot → N Center → Welfare Hall
const STOPS: LatLng[] = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
  { lat: 37.293999, lng: 126.973183 },
];

const fixture = (): NaverDirectionsResponse => JSON.parse(JSON.stringify(FIXTURE));
const route = (res: NaverDirectionsResponse) => res.route!.traoptimal![0]!;

function rejection(fn: () => unknown): DirectionsError {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(DirectionsError);
    return err as DirectionsError;
  }
  throw new Error("expected a DirectionsError");
}

describe("toNaverOffsets", () => {
  it("reads the travel time to each stop from the running guide sums", () => {
    // Act & Assert
    expect(toNaverOffsets(fixture(), STOPS)).toEqual([0, 4099, 4317]);
  });

  it("rejects a wrong count of waypoint (87) entries", () => {
    // Arrange
    const res = fixture();
    const guide = route(res).guide;
    const i = guide.findIndex((g) => g.type === 87);
    guide[i + 1]!.duration += guide[i]!.duration;
    guide.splice(i, 1);

    // Act
    const err = rejection(() => toNaverOffsets(res, STOPS));

    // Assert
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/expected 1 waypoint \(87\) and 1 goal \(88\) guide entries, got 0 and 1/);
  });

  it("rejects stop times that miss the route total by more than 30 s", () => {
    // Arrange
    const res = fixture();
    route(res).summary.duration += 31_000;

    // Act & Assert
    expect(rejection(() => toNaverOffsets(res, STOPS)).message).toMatch(/add up to 4316648 ms but the route total is 4347648 ms/);
    const close = fixture();
    route(close).summary.duration += 29_000;
    expect(toNaverOffsets(close, STOPS)).toEqual([0, 4099, 4317]);
  });

  it("Drop-off snapped to an outside road: rejects a stop more than 150 m from where the route places it", () => {
    // Arrange
    const moved = [...STOPS];
    moved[2] = { lat: 37.293999 + 0.00225, lng: 126.973183 }; // about 250 m north

    // Act
    const err = rejection(() => toNaverOffsets(fixture(), moved));

    // Assert
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/stop 2 is 2\d\d m from where the route places it/);
  });

  it("rejects offsets that go backwards", () => {
    // Arrange
    const res = fixture();
    const guide = route(res).guide;
    const goal = guide.findIndex((g) => g.type === 88);
    guide[goal - 1]!.duration = -300_000;

    // Act & Assert
    expect(rejection(() => toNaverOffsets(res, STOPS)).message).toMatch(/stop 2 is reached before stop 1/);
  });

  it("reports a non-zero code as an API failure, not a route", () => {
    // Act
    const err = rejection(() => toNaverOffsets({ code: 1, message: "출발지와 도착지가 동일합니다." }, STOPS));

    // Assert
    expect(err.kind).toBe("api");
    expect(err.retryable).toBe(false);
  });
});

