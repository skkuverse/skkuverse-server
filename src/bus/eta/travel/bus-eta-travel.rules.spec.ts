/**
 * toNaverOffsets reads the travel time to each stop from a NAVER Directions 5
 * response, over the live response captured on 2026-10-09 for
 * campus-inja.regular, and rejects implausible routes; and the route a bus-lane run is forced through: the corridor ends
 * as vias after the first stop, and the corridor's own leg.
 */
import fs from "fs";
import path from "path";
import { BusEtaDirectionsError } from "../bus-eta.error";
import type { LatLng } from "../../../shared/lat-lng.types";
import { toCorridorRoute, toCorridorRoutePoints, toNaverOffsets, toNaverRouteTimes } from "./bus-eta-travel.rules";
import type { NaverDirectionsResponse, RoutePoint } from "./bus-eta-travel.types";


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

function rejection(fn: () => unknown): BusEtaDirectionsError {
  try {
    fn();
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(BusEtaDirectionsError);
    return err as BusEtaDirectionsError;
  }
  throw new Error("expected a BusEtaDirectionsError");
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


describe("toNaverOffsets characterization: stops-only output pinned before the parser takes via points", () => {
  it("pins the offsets of a two-stop sequence, whose guide has a goal and no waypoint", () => {
    // Arrange
    const res = fixture();
    const guide = route(res).guide;
    const i = guide.findIndex((g) => g.type === 87);
    guide[i + 1]!.duration += guide[i]!.duration;
    guide.splice(i, 1);

    // Act & Assert
    expect(toNaverOffsets(res, [STOPS[0]!, STOPS[2]!])).toEqual([0, 4317]);
  });

  it("pins the full message of each implausible route", () => {
    // Arrange
    const missingGoal = fixture();
    route(missingGoal).guide = route(missingGoal).guide.filter((g) => g.type !== 88);
    const backwards = fixture();
    const guide = route(backwards).guide;
    guide[guide.findIndex((g) => g.type === 88) - 1]!.duration = -300_000;
    const pastEnd = fixture();
    route(pastEnd).guide.find((g) => g.type === 88)!.pointIndex = 99_999;
    const moved = [...STOPS];
    moved[2] = { lat: 37.293999 + 0.00225, lng: 126.973183 };

    // Act & Assert
    expect(() => toNaverOffsets({ code: 0, message: "ok", route: {} }, STOPS)).toThrow("no traoptimal route in the response");
    expect(() => toNaverOffsets(missingGoal, STOPS)).toThrow("expected 1 waypoint (87) and 1 goal (88) guide entries, got 1 and 0");
    expect(() => toNaverOffsets(backwards, STOPS)).toThrow("stop 2 is reached before stop 1 (3838957 ms < 4098713 ms)");
    expect(() => toNaverOffsets(pastEnd, STOPS)).toThrow("stop 2 points past the end of the path (index 99999)");
    expect(() => toNaverOffsets(fixture(), moved)).toThrow("stop 2 is 251 m from where the route places it (limit 150 m)");
    expect(() => toNaverOffsets({ code: 1, message: "출발지와 도착지가 동일합니다." }, STOPS)).toThrow("code 1 (출발지와 도착지가 동일합니다.)");
  });
});

/**
 * A synthetic forced route (stop, via, via, stop) along a straight path north,
 * never captured: the guide's 87, 87 and 88 entries sit on path points 2, 4
 * and 6, at 100, 700 and 820.5 s.
 */
const PATH: Array<[number, number]> = [0, 1, 2, 3, 4, 5, 6].map((k) => [127.0, 37.3 + k * 0.01]);
const pathPoint = (k: number): LatLng => ({ lat: PATH[k]![1], lng: PATH[k]![0] });
const FORCED_POINTS: RoutePoint[] = [
  { at: pathPoint(0), kind: "stop" },
  { at: pathPoint(2), kind: "via" },
  { at: pathPoint(4), kind: "via" },
  { at: pathPoint(6), kind: "stop" },
];

function forcedRoute(): NaverDirectionsResponse {
  const guide = [
    { pointIndex: 1, type: 3, distance: 1000, duration: 60_000 },
    { pointIndex: 2, type: 87, distance: 1000, duration: 40_000 },
    { pointIndex: 3, type: 2, distance: 1000, duration: 500_000 },
    { pointIndex: 4, type: 87, distance: 1000, duration: 100_000 },
    { pointIndex: 5, type: 3, distance: 1000, duration: 50_000 },
    { pointIndex: 6, type: 88, distance: 1000, duration: 70_500 },
  ];
  return { code: 0, message: "ok", route: { traoptimal: [{ summary: { duration: 820_500, distance: 6000 }, path: PATH, guide }] } };
}

describe("toNaverRouteTimes", () => {
  it("splits a forced route (stop, via, via, stop) into legs, with offsets for its two stops only", () => {
    // Act
    const times = toNaverRouteTimes(forcedRoute(), FORCED_POINTS);

    // Assert
    expect(times).toEqual({ stopOffsetsSec: [0, 821], legsSec: [100, 600, 121] });
  });

  it("reads the captured route with its middle point as a via: one leg each side of it", () => {
    // Arrange
    const points: RoutePoint[] = [
      { at: STOPS[0]!, kind: "stop" },
      { at: STOPS[1]!, kind: "via" },
      { at: STOPS[2]!, kind: "stop" },
    ];

    // Act & Assert
    expect(toNaverRouteTimes(fixture(), points)).toEqual({ stopOffsetsSec: [0, 4317], legsSec: [4099, 218] });
  });

  it("gives a stops-only route the offsets toNaverOffsets gives, and a leg between each two stops", () => {
    // Arrange
    const points: RoutePoint[] = STOPS.map((at) => ({ at, kind: "stop" }));

    // Act & Assert
    expect(toNaverRouteTimes(fixture(), points)).toEqual({ stopOffsetsSec: [0, 4099, 4317], legsSec: [4099, 218] });
  });

  it.each([
    ["140 m", 0.00126, null],
    ["200 m", 0.0018, /via 1 is 200 m from where the route places it \(limit 150 m\)/],
  ])("Via point snapped to a parallel road: a via point %s off the path is held to the 150 m limit", (_label, dLat, rejected) => {
    // Arrange
    const points = FORCED_POINTS.map((p, index) => (index === 1 ? { ...p, at: { ...p.at, lat: p.at.lat + dLat } } : p));

    // Act
    const parse = () => toNaverRouteTimes(forcedRoute(), points);

    // Assert
    if (rejected) expect(rejection(parse)).toMatchObject({ kind: "implausible", message: expect.stringMatching(rejected) });
    else expect(parse().legsSec).toEqual([100, 600, 121]);
  });

  it("rejects a guide with fewer waypoint (87) entries than via points and middle stops", () => {
    // Arrange
    const res = forcedRoute();
    const guide = route(res).guide;
    guide[2]!.duration += guide[1]!.duration;
    guide.splice(1, 1);

    // Act
    const err = rejection(() => toNaverRouteTimes(res, FORCED_POINTS));

    // Assert
    expect(err.kind).toBe("implausible");
    expect(err.message).toMatch(/expected 2 waypoint \(87\) and 1 goal \(88\) guide entries, got 1 and 1/);
  });

  it("rejects leg times that miss the route total by more than 30 s, and keeps one that misses it by 29 s", () => {
    // Arrange
    const far = forcedRoute();
    route(far).summary.duration += 31_000;
    const close = forcedRoute();
    route(close).summary.duration += 29_000;

    // Act & Assert
    expect(rejection(() => toNaverRouteTimes(far, FORCED_POINTS)).message).toMatch(/add up to 820500 ms but the route total is 851500 ms/);
    expect(toNaverRouteTimes(close, FORCED_POINTS).stopOffsetsSec).toEqual([0, 821]);
  });
});

describe("toCorridorRoutePoints", () => {
  const ENDS = { entry: { lat: 37.512474, lng: 127.015177 }, exit: { lat: 37.292547, lng: 127.102684 } };

  it("puts the corridor entry and exit as vias between the first stop and every later one", () => {
    // Act
    const points = toCorridorRoutePoints(STOPS, ENDS);

    // Assert
    expect(points).toEqual([
      { at: STOPS[0], kind: "stop" },
      { at: ENDS.entry, kind: "via" },
      { at: ENDS.exit, kind: "via" },
      { at: STOPS[1], kind: "stop" },
      { at: STOPS[2], kind: "stop" },
    ]);
  });

  it("refuses a sequence with no stop after the first", () => {
    // Act & Assert
    expect(() => toCorridorRoutePoints([STOPS[0]!], ENDS)).toThrow("a corridor route needs a first stop and a later one");
  });
});

describe("toCorridorRoute", () => {
  it("answers the second leg, entry to exit, as the corridor's car time", () => {
    // Act
    const corridorRoute = toCorridorRoute({ stopOffsetsSec: [0, 4620], legsSec: [900, 1920, 1800] });

    // Assert
    expect(corridorRoute).toEqual({ stopOffsetsSec: [0, 4620], corridorCarSec: 1920 });
  });

  it("refuses times with no corridor leg", () => {
    // Act & Assert
    expect(() => toCorridorRoute({ stopOffsetsSec: [0, 4620], legsSec: [4620] })).toThrow("got 1 legs");
  });
});
