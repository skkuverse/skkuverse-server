/**
 * toStationEtas places TOPIS busList rows by TOPIS ord, confirmed by the
 * station ID at that ord. Name matching dropped ETAs when TOPIS renamed a
 * stop and piled both ETAs of a same-named stop pair onto the first one. ID
 * matching alone can't tell 02's loop terminal (ord 1 departing, ord 27
 * arriving) apart.
 *
 * A tracked Jongro bus (add-jongro-bus-positions): its rows found by vehicle,
 * its status (waiting at a terminal or by its next-stop text, at a stop,
 * running), its progress through the section and its seconds to the next
 * stop re-based to TOPIS's observation time; a position a full section behind
 * its arrival rows served running, and a waiting vehicle's arrivals read
 * waiting (D7). Its trajectory (add-jongro-bus-trajectory): the observation,
 * an atStop bus's expected departure, then up to three next stops at their
 * re-based travel times, each at least 20 s after the previous knot.
 */

import { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BusRegistryRepository } from "../../registry/bus-registry.repository";
import { BusRegistryService } from "../../registry/bus-registry.service";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { jongroArrivalBus, jongroPositionDoc, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import {
  isLaggingPosition,
  toHighestSectOrd,
  toJongroBusTracking,
  toNamedBuses,
  toNextStopInSec,
  toProgress,
  toStationEtas,
  toTrackedStatus,
  toTrajectory,
  toVehicleBuses,
  toWaitingArrival,
  toWaitingVehicleIds,
} from "./bus-realtime-group.rules";

describe("toStationEtas", () => {
  // WHY: the routes as the registry seeds them from the committed snapshot, which these stop ids come from.
  let r02: RegistryRoute;
  let r07: RegistryRoute;

  beforeAll(async () => {
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(new FakeBusRegistryRepository()), { now: () => new Date("2026-10-17T12:00:00Z") });
    await registry.onModuleInit();
    [r02, r07] = [await registry.routeOf("jongro02"), await registry.routeOf("jongro07")];
  });

  it("puts each same-named stop's ETA on its own index", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100000423", sequence: "21", stationName: "비천당", eta: "2분후[1번째 전]" },
      { stationId: "100000424", sequence: "3", stationName: "비천당", eta: "7분후[3번째 전]" },
    ]);

    // Assert
    expect(etas).toEqual([
      { stationIndex: 20, eta: "2분후[1번째 전]" },
      { stationIndex: 2, eta: "7분후[3번째 전]" },
    ]);
  });

  it("keeps the departing and arriving ETAs of a loop terminal apart", () => {
    // Act
    const etas = toStationEtas(r02, [
      { stationId: "100900204", sequence: "1", stationName: "성균관대학교", eta: "출발대기" },
      { stationId: "100900204", sequence: "27", stationName: "성균관대학교", eta: "1분45초후[1번째 전]" },
    ]);

    // Assert
    expect(etas).toEqual([
      { stationIndex: 0, eta: "출발대기" },
      { stationIndex: 26, eta: "1분45초후[1번째 전]" },
    ]);
  });

  it("matches by ID even when the row carries a different name", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100000125", sequence: "12", stationName: "옛 이름", eta: "곧 도착" },
    ]);

    // Assert
    expect(etas).toEqual([{ stationIndex: 11, eta: "곧 도착" }]);
  });

  it("falls back to the ID when TOPIS has reordered the stop", () => {
    // Act
    const etas = toStationEtas(r07, [
      { stationId: "100900197", sequence: "9", stationName: "명륜새마을금고", eta: "곧 도착" },
    ]);

    // Assert
    expect(etas).toEqual([{ stationIndex: 5, eta: "곧 도착" }]);
  });

  it("drops unmapped stations, rows without an eta, and non-array input", () => {
    // Act & Assert
    expect(
      toStationEtas(r07, [
        { stationId: "999999999", sequence: "1", stationName: "비천당", eta: "곧 도착" },
        { stationId: "100900197", sequence: "6", stationName: "명륜새마을금고", eta: "" },
      ]),
    ).toEqual([]);
    expect(toStationEtas(r07, undefined)).toEqual([]);
  });
});

// 2026-10-17 production capture (pos_/arr_<busRouteId>_<epoch>.json): route 02 = 27 stops, turnaround 100900121;
// route 07 = 22 stops, turnaround 100900028.
const ROUTE02 = { stationCount: 27, turnaroundTopisId: "100900121" };
const ROUTE07 = { stationCount: 22, turnaroundTopisId: "100900028" };

// Route 02 vehicle 100000058 at ord 17, observed 19:12:02 (pos_100900008_1792231942).
const running58 = jongroPositionDoc({
  sequence: "17",
  stationId: "100000104",
  carNumber: "2008",
  vehicleId: "100000058",
  sectDist: 0.114,
  fullSectDist: 0.251,
  isAtStop: false,
  observedAt: "2026-10-17T19:12:02+09:00",
  isStationary: false,
});
// Its bus on the ord 18 row made at 19:12:10 (arr_100900008_1792231942).
const next58 = {
  bus: jongroArrivalBus({ vehId: "100000058", plainNo: "서울75사2008", staOrd: 18, sectOrd: 18, traTime: 20, arrmsg: "곧 도착", rerideDiv: 2, rerideNum: 1 }),
  madeAt: "2026-10-17 19:12:10.0",
};

describe("toVehicleBuses", () => {
  const row = (sequence: string, eventDate: string, buses: ReturnType<typeof jongroArrivalBus>[]) => ({ sequence, eventDate, buses });

  it("finds the vehicle's bus on its next stop's row, in either slot", () => {
    // Arrange
    const rows = [
      row("17", "2026-10-17 19:12:10.0", [noArrivalBus({ staOrd: 17 }), noArrivalBus({ staOrd: 17 })]),
      row("18", "2026-10-17 19:12:10.0", [jongroArrivalBus({ vehId: "100000059", staOrd: 18 }), next58.bus]),
      row("19", "2026-10-17 19:12:10.0", [jongroArrivalBus({ vehId: "100000058", staOrd: 19, traTime: 96 }), noArrivalBus({ staOrd: 19 })]),
    ];

    // Act
    const found = toVehicleBuses(rows, "100000058", 17);

    // Assert
    expect(found).toEqual({ nextStop: next58, firstNamed: next58.bus });
  });

  it("falls back to the first row in station order that names the vehicle", () => {
    // Arrange
    const at20 = jongroArrivalBus({ vehId: "100000058", staOrd: 20, traTime: 159 });
    const at19 = jongroArrivalBus({ vehId: "100000058", staOrd: 19, traTime: 96 });
    const rows = [row("20", "2026-10-17 19:12:10.0", [at20]), row("19", "2026-10-17 19:12:10.0", [at19])];

    // Act
    const found = toVehicleBuses(rows, "100000058", 17);

    // Assert
    expect(found).toEqual({ nextStop: undefined, firstNamed: at19 });
  });

  it("finds nothing for a vehicle no row names, as for an idling bus at its origin", () => {
    // Act & Assert
    expect(toVehicleBuses([row("2", "2026-10-17 19:11:20.0", [noArrivalBus({ staOrd: 2 })])], "100000018", 1)).toEqual({
      nextStop: undefined,
      firstNamed: undefined,
    });
  });
});

describe("toTrackedStatus", () => {
  const at = (extra: Parameters<typeof jongroPositionDoc>[0]) => jongroPositionDoc({ stationId: "100900202", sequence: "5", isAtStop: false, isStationary: false, ...extra });

  it.each([
    ["stationary at index 0", at({ sequence: "1", stationId: "100900204", isStationary: true }), undefined, "waiting"],
    ["stationary at the last index", at({ sequence: "27", stationId: "100900204", isStationary: true }), undefined, "waiting"],
    ["stationary at the turnaround stop", at({ sequence: "14", stationId: "100900121", isStationary: true }), undefined, "waiting"],
    ["stationary mid-route with stopFlag 1", at({ sequence: "5", isStationary: true, isAtStop: true }), undefined, "atStop"],
    ["stationary mid-route", at({ sequence: "5", isStationary: true }), undefined, "running"],
    ["moving at index 0", at({ sequence: "1", stationId: "100900204" }), undefined, "running"],
    ["at index 0 with a 출발대기 next stop", at({ sequence: "1", stationId: "100900204" }), "waiting", "waiting"],
    ["with stopFlag 1 and a 출발대기 next stop", at({ sequence: "5", isAtStop: true }), "waiting", "waiting"],
    ["with stopFlag 1", at({ isAtStop: true }), "arriving", "atStop"],
    ["at the last index, moving", at({ sequence: "27", stationId: "100900204" }), undefined, "atStop"],
    ["at the second-last index", at({ sequence: "26", stationId: "100900203" }), "running", "running"],
  ] as const)("%s → %s", (_case, position, nextStopState, expected) => {
    // Act & Assert
    expect(toTrackedStatus(position, { ...ROUTE02, nextStopState })).toBe(expected);
  });
});

describe("toProgress", () => {
  it.each([
    [0.114, 0.251, 0.114 / 0.251],
    [0, 0.295, 0],
    [0.3, 0.3, 1],
    [0.31, 0.3, 1],
    [0.1, 0, 0],
    [0.1, -0.1, 0],
  ])("%d of %d → %d", (sectDist, fullSectDist, expected) => {
    // Act & Assert
    expect(toProgress(sectDist, fullSectDist)).toBe(expected);
  });
});

describe("toNextStopInSec", () => {
  it.each([
    ["a row made 8 s after the observation", "2026-10-17 19:12:10.0", 20, 28],
    ["a row made at the observation", "2026-10-17 19:12:02.0", 20, 20],
    ["a row made 19 s before the observation", "2026-10-17 19:11:43.0", 20, 1],
    ["a row made 20 s before the observation", "2026-10-17 19:11:42.0", 20, 0],
    ["a row made 21 s before the observation", "2026-10-17 19:11:41.0", 20, 0],
    ["a row whose mkTm does not parse", "19:12:10", 20, null],
  ])("%s → %j", (_case, madeAt, traTime, expected) => {
    // Act & Assert
    expect(toNextStopInSec({ bus: jongroArrivalBus({ traTime }), madeAt }, "2026-10-17T19:12:02+09:00")).toBe(expected);
  });

  it("is null without a next-stop row naming the vehicle", () => {
    // Act & Assert
    expect(toNextStopInSec(undefined, "2026-10-17T19:12:02+09:00")).toBeNull();
  });
});

describe("toJongroBusTracking", () => {
  it("tracks a running bus with its progress, segment and re-based countdown", () => {
    // Act
    const tracking = toJongroBusTracking(running58, {
      ...ROUTE02,
      nextStop: next58,
      arrival: { state: "arriving", crowding: "relaxed", isLastBus: false },
      namedBuses: [next58],
    });

    // Assert
    // WHY: trajectory is what add-jongro-bus-trajectory adds to a running or atStop bus (task 2.2).
    expect(tracking).toEqual({
      status: "running",
      vehicleId: "100000058",
      observedAt: "2026-10-17T19:12:02+09:00",
      crowding: "relaxed",
      isLastBus: false,
      progress: 0.114 / 0.251,
      segmentMeters: 251,
      nextStopInSec: 28,
      trajectory: [
        { atMs: Date.parse("2026-10-17T19:12:02+09:00"), s: 16 + 0.114 / 0.251 },
        { atMs: Date.parse("2026-10-17T19:12:30+09:00"), s: 17 },
      ],
    });
  });

  it("tracks a bus at a stop with no progress and no countdown (종로07 vehicle 100000103, pos_100900004_1792231921)", () => {
    // Arrange
    const position = jongroPositionDoc({
      sequence: "14",
      stationId: "100900043",
      vehicleId: "100000103",
      sectDist: 0,
      fullSectDist: 0.295,
      isAtStop: true,
      observedAt: "2026-10-17T19:11:44+09:00",
    });
    const nextStop = { bus: jongroArrivalBus({ vehId: "100000103", staOrd: 15, sectOrd: 15, traTime: 61, arrmsg: "곧 도착", rerideNum: 0 }), madeAt: "2026-10-17 19:11:46.0" };

    // Act
    const tracking = toJongroBusTracking(position, { ...ROUTE07, nextStop, arrival: { state: "arriving", crowding: "relaxed", isLastBus: false }, namedBuses: [nextStop] });

    // Assert
    // WHY: trajectory is what add-jongro-bus-trajectory adds to a running or atStop bus (task 2.2).
    expect(tracking).toEqual({
      status: "atStop",
      vehicleId: "100000103",
      observedAt: "2026-10-17T19:11:44+09:00",
      crowding: "relaxed",
      isLastBus: false,
      progress: 0,
      segmentMeters: 295,
      nextStopInSec: null,
      trajectory: [
        { atMs: Date.parse("2026-10-17T19:11:44+09:00"), s: 13 },
        { atMs: Date.parse("2026-10-17T19:11:59+09:00"), s: 13 },
        { atMs: Date.parse("2026-10-17T19:12:47+09:00"), s: 14 },
      ],
    });
  });

  it("reads a waiting text only from the next stop's row, not from a later one", () => {
    // Act
    const tracking = toJongroBusTracking(running58, { ...ROUTE02, nextStop: undefined, arrival: { state: "waiting", crowding: null, isLastBus: true }, namedBuses: [] });

    // Assert
    expect(tracking).toMatchObject({ status: "running", crowding: null, isLastBus: true, nextStopInSec: null });
  });

  it("serves no crowding and no last bus for a vehicle no row names", () => {
    // Act
    const tracking = toJongroBusTracking(running58, { ...ROUTE02, nextStop: undefined, arrival: undefined, namedBuses: [] });

    // Assert
    expect(tracking).toMatchObject({ crowding: null, isLastBus: false, nextStopInSec: null });
  });
});

// WHY: the arrival API counts the section toward the next stop, one ahead of the position's sectOrd, so a gap of
// 2 means the position is a section stale (add-jongro-bus-positions D7, 966 of 1,032 same-epoch pairs at 1).
describe("isLaggingPosition", () => {
  it.each([
    ["no row names the vehicle", undefined, false],
    ["the next stop's section", 6, false],
    ["a section ahead of that", 7, true],
    ["two sections ahead of that", 8, true],
  ] as const)("%s → %s", (_case, highestSectOrd, expected) => {
    // Act & Assert
    expect(isLaggingPosition(jongroPositionDoc({ sequence: "5" }), highestSectOrd)).toBe(expected);
  });
});

describe("toHighestSectOrd", () => {
  it("takes the highest sectOrd any row gives the vehicle, in either slot (arr_100900004_1792232615)", () => {
    // Arrange
    const rows = [
      { buses: [jongroArrivalBus({ vehId: "100000035", staOrd: 7, sectOrd: 7, arrmsg: "곧 도착" }), noArrivalBus({ staOrd: 7, arrmsg: "출발대기" })] },
      { buses: [jongroArrivalBus({ vehId: "100000114", staOrd: 16, sectOrd: 16, arrmsg: "곧 도착" }), jongroArrivalBus({ vehId: "100000035", staOrd: 16, sectOrd: 7 })] },
      { buses: [jongroArrivalBus({ vehId: "100000035", staOrd: 6, sectOrd: 6 }), noArrivalBus({ staOrd: 6 })] },
    ];

    // Act & Assert
    expect(toHighestSectOrd(rows, "100000035")).toBe(7);
  });

  it("is undefined for a vehicle no row names", () => {
    // Act & Assert
    expect(toHighestSectOrd([{ buses: [noArrivalBus({ staOrd: 2, arrmsg: "출발대기" })] }], "100000018")).toBeUndefined();
  });
});

describe("toTrackedStatus with a lagging position", () => {
  // Route 07 vehicle 100000035's position at 19:22:58 (pos_100900004_1792232595), stopFlag 1 at ord 5.
  const stale35 = jongroPositionDoc({ sequence: "5", stationId: "100000421", vehicleId: "100000035", sectDist: 0, fullSectDist: 0.225, isAtStop: true, observedAt: "2026-10-17T19:22:58+09:00" });
  // Route 02 vehicle 100000018 standing still at its origin at 19:21:01 (pos_100900008_1792232472).
  const idle18 = jongroPositionDoc({ sequence: "1", stationId: "100900204", vehicleId: "100000018", sectDist: 0.031, fullSectDist: 0.259, isStationary: true });

  it.each([
    ["at a stop, the rows a section ahead", stale35, ROUTE07, 7, undefined, "running"],
    ["at a stop, the rows at the next stop's section", stale35, ROUTE07, 6, "arriving", "atStop"],
    ["standing still at the origin, the rows a section ahead", idle18, ROUTE02, 3, undefined, "running"],
    ["standing still at the origin, 곧 도착 at the next stop", idle18, ROUTE02, 2, "arriving", "waiting"],
    ["with a 출발대기 next stop, the rows a section ahead", stale35, ROUTE07, 7, "waiting", "running"],
  ] as const)("%s → %s", (_case, position, route, highestSectOrd, nextStopState, expected) => {
    // Act & Assert
    expect(toTrackedStatus(position, { ...route, nextStopState, highestSectOrd })).toBe(expected);
  });

  it("tracks a lagging bus as running with the position's progress and no countdown without a next-stop row", () => {
    // Act
    const tracking = toJongroBusTracking(stale35, {
      ...ROUTE07,
      highestSectOrd: 7,
      nextStop: undefined,
      arrival: { state: "arriving", crowding: "relaxed", isLastBus: false },
      namedBuses: [],
    });

    // Assert
    // WHY: trajectory is what add-jongro-bus-trajectory adds to a running or atStop bus (task 2.2).
    expect(tracking).toEqual({
      status: "running",
      vehicleId: "100000035",
      observedAt: "2026-10-17T19:22:58+09:00",
      crowding: "relaxed",
      isLastBus: false,
      progress: 0,
      segmentMeters: 225,
      nextStopInSec: null,
      // (An agent tooling note is left out of the public history.)
      trajectory: [
        { atMs: Date.parse("2026-10-17T19:22:58+09:00"), s: 4 },
        { atMs: Date.parse("2026-10-17T19:23:54+09:00"), s: 5 },
      ],
    });
  });
});

describe("toWaitingArrival", () => {
  const arrival = { stopsAway: 0, isLastBus: false, carNumber: "5512", crowding: "relaxed" as const, passengerCount: 1 };

  it.each([
    ["곧 도착", { ...arrival, minutes: null, state: "arriving" as const, message: "곧 도착" }],
    ["a timed text", { ...arrival, minutes: 2, stopsAway: 1, state: "running" as const, message: "1분47초후[1번째 전]" }],
  ])("serves %s as waiting with no minutes, keeping the message and the rest", (_case, input) => {
    // Act & Assert
    expect(toWaitingArrival(input)).toEqual({ ...input, state: "waiting", minutes: null });
  });
});

describe("toWaitingVehicleIds", () => {
  it("collects the vehicles of tracked buses whose status is waiting", () => {
    // Arrange
    // An atStop bus carries its trajectory since add-jongro-bus-trajectory.
    const common = { stationIndex: 0, carNumber: "5512", estimatedTime: 0 };
    const tracked = { observedAt: "2026-10-17T19:21:01+09:00", crowding: null, isLastBus: false };
    const buses = [
      { ...common, kind: "tracked" as const, tracked: { status: "waiting" as const, vehicleId: "100000018", ...tracked } },
      { ...common, kind: "tracked" as const, tracked: { status: "atStop" as const, vehicleId: "100000015", ...tracked, trajectory: [{ at: "2026-10-17T19:21:01+09:00", s: 26 }] } },
      { ...common, kind: "estimated" as const },
    ];

    // Act & Assert
    expect(toWaitingVehicleIds(buses)).toEqual(new Set(["100000018"]));
  });
});

// WHY: the app interpolates a tracked bus through knots of (instant, s) (add-jongro-bus-trajectory D2). The rows are
// the 2026-10-18 production capture's (pos_/arr_<busRouteId>_<epoch>), unless a case says it is hand-edited.
describe("toTrajectory", () => {
  const ROUTE08 = { stationCount: 31 };
  const at = (hhmmss: string) => Date.parse(`2026-10-18T${hhmmss}+09:00`);
  const named = (vehId: string, madeAt: string, ...rows: Array<[staOrd: number, traTime: number]>) =>
    rows.map(([staOrd, traTime]) => ({ bus: jongroArrivalBus({ vehId, staOrd, traTime }), madeAt: `2026-10-18 ${madeAt}.0` }));

  // Route 02 vehicle 100000088 running at ord 8 at 18:07:45 (epoch 1792314485), named at ords 9 to 13.
  const running88 = jongroPositionDoc({ sequence: "8", vehicleId: "100000088", sectDist: 0.015, fullSectDist: 0.118, observedAt: "2026-10-18T18:07:45+09:00" });
  const rows88 = named("100000088", "18:07:53", [9, 15], [10, 47], [11, 161], [12, 208], [13, 324]);
  // Route 02 vehicle 100000058 at a stop at ord 19 at 18:08:33 (epoch 1792314531), its first observation there.
  const atStop58 = jongroPositionDoc({ sequence: "19", vehicleId: "100000058", sectDist: 0, fullSectDist: 0.135, isAtStop: true, observedAt: "2026-10-18T18:08:33+09:00" });
  const rows58 = named("100000058", "18:08:36", [20, 58], [21, 114], [22, 158], [23, 197]);

  it("starts at the observation and reaches the next three stops at their re-based travel times", () => {
    // Act
    const trajectory = toTrajectory(running88, "running", { ...ROUTE02, namedBuses: rows88 });

    // Assert
    expect(trajectory).toEqual([
      { atMs: at("18:07:45"), s: 7 + 0.015 / 0.118 },
      { atMs: at("18:08:08"), s: 8 },
      { atMs: at("18:08:40"), s: 9 },
      { atMs: at("18:10:34"), s: 10 },
    ]);
  });

  it("holds a bus at its stop until its expected departure, then reaches the next stops", () => {
    // Act
    const trajectory = toTrajectory({ ...atStop58, atStopSince: "2026-10-18T18:08:33+09:00" }, "atStop", { ...ROUTE02, namedBuses: rows58 });

    // Assert
    expect(trajectory).toEqual([
      { atMs: at("18:08:33"), s: 18 },
      { atMs: at("18:08:48"), s: 18 },
      { atMs: at("18:09:34"), s: 19 },
      { atMs: at("18:10:30"), s: 20 },
      { atMs: at("18:11:14"), s: 21 },
    ]);
  });

  it.each([
    ["no record of since when, as after a restart", undefined, at("18:08:48")],
    ["standing there 14 s", "2026-10-18T18:08:19+09:00", at("18:08:34")],
    ["standing there 15 s", "2026-10-18T18:08:18+09:00", undefined],
    ["standing there 16 s", "2026-10-18T18:08:17+09:00", undefined],
  ])("departs a bus at its stop with %s at %s", (_case, atStopSince, departureMs) => {
    // Act
    const [first, second] = toTrajectory({ ...atStop58, atStopSince }, "atStop", { ...ROUTE02, namedBuses: rows58 });

    // Assert
    expect(first).toEqual({ atMs: at("18:08:33"), s: 18 });
    expect(second).toEqual(departureMs === undefined ? { atMs: at("18:09:34"), s: 19 } : { atMs: departureMs, s: 18 });
  });

  it("counts a dwell from the first observation at the stop and stops at the first stop no row names the vehicle there", () => {
    // Arrange
    // Route 08 vehicle 100000010 at a stop at ord 11 since 18:08:29, observed at 18:08:34 (epoch 1792314531) and
    // named on the ord 12 row only.
    const position = jongroPositionDoc({ sequence: "11", vehicleId: "100000010", sectDist: 0.057, fullSectDist: 0.257, isAtStop: true, observedAt: "2026-10-18T18:08:34+09:00", atStopSince: "2026-10-18T18:08:29+09:00" });

    // Act
    const trajectory = toTrajectory(position, "atStop", { ...ROUTE08, namedBuses: named("100000010", "18:08:46", [12, 61], [14, 170]) });

    // Assert
    expect(trajectory).toEqual([
      { atMs: at("18:08:34"), s: 10 },
      { atMs: at("18:08:44"), s: 10 },
      { atMs: at("18:09:47"), s: 11 },
    ]);
  });

  it("moves a next stop already due at the observation to 20 s after it, and keeps later stops", () => {
    // Arrange
    // Route 08 vehicle 100000077 at ord 20 at 18:10:45 (epoch 1792314652): its ord 21 row, made at 18:10:33, has it
    // there at 18:10:38, before the observation; it reached ord 21 by 18:11:19.
    const position = jongroPositionDoc({ sequence: "20", vehicleId: "100000077", sectDist: 0.101, fullSectDist: 0.304, observedAt: "2026-10-18T18:10:45+09:00", isStationary: true });

    // Act
    const trajectory = toTrajectory(position, "running", { ...ROUTE08, namedBuses: named("100000077", "18:10:33", [21, 5], [22, 95], [23, 177]) });

    // Assert
    expect(trajectory).toEqual([
      { atMs: at("18:10:45"), s: 19 + 0.101 / 0.304 },
      { atMs: at("18:11:05"), s: 20 },
      { atMs: at("18:12:08"), s: 21 },
      { atMs: at("18:13:30"), s: 22 },
    ]);
  });

  it.each([
    ["19 s after the previous knot (hand-edited)", 19, at("18:08:05")],
    ["20 s after it", 20, at("18:08:05")],
    ["21 s after it", 21, at("18:08:06")],
  ])("keeps a next stop at least 20 s after the previous knot: one %s", (_case, gapSec, expectedMs) => {
    // Arrange
    const rows = named("100000088", "18:07:45", [9, gapSec]);

    // Act
    const [, next] = toTrajectory(running88, "running", { ...ROUTE02, namedBuses: rows });

    // Assert
    expect(next).toEqual({ atMs: expectedMs, s: 8 });
  });

  it("moves a later stop the rows put before an earlier one to 20 s after it (hand-edited: no captured pair inverted)", () => {
    // Act
    const trajectory = toTrajectory(running88, "running", { ...ROUTE02, namedBuses: named("100000088", "18:07:53", [9, 15], [10, 160], [11, 150]) });

    // Assert
    expect(trajectory.map((knot) => knot.atMs)).toEqual([at("18:07:45"), at("18:08:08"), at("18:10:33"), at("18:10:53")]);
  });

  it("serves no trajectory for a waiting bus (route 02 vehicle 100000059 idling at its origin, epoch 1792314485)", () => {
    // Arrange
    const position = jongroPositionDoc({ sequence: "1", vehicleId: "100000059", sectDist: 0.043, fullSectDist: 0.259, observedAt: "2026-10-18T18:07:53+09:00", isStationary: true });

    // Act & Assert
    expect(toTrajectory(position, "waiting", { ...ROUTE02, namedBuses: [] })).toEqual([]);
  });

  it("goes no further than the last index (route 08 vehicle 100000078 at ord 29, epoch 1792314485)", () => {
    // Arrange
    // The ord 32 row is hand-added: route 08 ends at ord 31, so no stop past it may be reached.
    const position = jongroPositionDoc({ sequence: "29", vehicleId: "100000078", sectDist: 0.038, fullSectDist: 0.176, observedAt: "2026-10-18T18:07:55+09:00" });
    const rows = [...named("100000078", "18:07:51", [30, 30], [31, 59]), ...named("100000078", "18:07:51", [32, 90])];

    // Act
    const trajectory = toTrajectory(position, "running", { ...ROUTE08, namedBuses: rows });

    // Assert
    expect(trajectory).toEqual([
      { atMs: at("18:07:55"), s: 28 + 0.038 / 0.176 },
      { atMs: at("18:08:21"), s: 29 },
      { atMs: at("18:08:50"), s: 30 },
    ]);
  });

  it("holds a bus at the last index at its observation, with no departure (hand-edited: no 2026-10-18 row reached 종로02's ord 27)", () => {
    // Arrange
    const position = jongroPositionDoc({ sequence: "27", vehicleId: "100000015", sectDist: 0, fullSectDist: 0.1, isAtStop: true, observedAt: "2026-10-18T18:09:00+09:00" });

    // Act & Assert
    expect(toTrajectory(position, "atStop", { ...ROUTE02, namedBuses: named("100000015", "18:09:00", [28, 30]) })).toEqual([{ atMs: at("18:09:00"), s: 26 }]);
  });

  it("reaches a next stop no row names the vehicle at by its distance at 4 m/s, then follows the rows", () => {
    // Act
    const trajectory = toTrajectory(running88, "running", { ...ROUTE02, namedBuses: named("100000088", "18:07:53", [10, 47]) });

    // (An agent tooling note is left out of the public history.)
    expect(trajectory).toEqual([
      { atMs: at("18:07:45"), s: 7 + 0.015 / 0.118 },
      { atMs: at("18:08:11"), s: 8 },
      { atMs: at("18:08:40"), s: 9 },
    ]);
  });

  it("stops at a row whose mkTm does not parse", () => {
    // Arrange
    const rows = [...named("100000088", "18:07:53", [9, 15]), { bus: jongroArrivalBus({ vehId: "100000088", staOrd: 10, traTime: 47 }), madeAt: "18:07:53" }];

    // Act & Assert
    expect(toTrajectory(running88, "running", { ...ROUTE02, namedBuses: rows }).map((knot) => knot.s)).toEqual([7 + 0.015 / 0.118, 8]);
  });
});

describe("toNamedBuses", () => {
  it("lists every bus slot naming the vehicle by stop ord, with when its row was made (arr_100900008_1792314485)", () => {
    // Arrange
    const rows = [
      { eventDate: "2026-10-18 18:07:53.0", buses: [jongroArrivalBus({ vehId: "100000088", staOrd: 10, traTime: 47 }), noArrivalBus({ staOrd: 10 })] },
      { eventDate: "2026-10-18 18:07:53.0", buses: [jongroArrivalBus({ vehId: "100000058", staOrd: 9, traTime: 500 }), jongroArrivalBus({ vehId: "100000088", staOrd: 9, traTime: 15 })] },
    ];

    // Act & Assert
    expect(toNamedBuses(rows, "100000088").map(({ bus, madeAt }) => [bus.staOrd, bus.traTime, madeAt])).toEqual([
      [9, 15, "2026-10-18 18:07:53.0"],
      [10, 47, "2026-10-18 18:07:53.0"],
    ]);
  });
});

// WHY: with a trajectory the app ignores nextStopInSec and segmentMeters, so a next stop TOPIS gives no time for is
// still reached at the app's own 4 m/s (add-jongro-bus-trajectory D2, agreed with skkuverse-app).
describe("toTrajectory without a travel time", () => {
  const at = (hhmmss: string) => Date.parse(`2026-10-18T${hhmmss}+09:00`);
  const named = (vehId: string, madeAt: string, ...rows: Array<[staOrd: number, traTime: number]>) =>
    rows.map(([staOrd, traTime]) => ({ bus: jongroArrivalBus({ vehId, staOrd, traTime }), madeAt: `2026-10-18 ${madeAt}.0` }));
  // Route 02 vehicle 100000058 running at ord 21 at 18:10:53 (epoch 1792314672), 88 m into a 165 m section and named
  // at ords 23 to 25 but not at ord 22.
  const ahead58 = jongroPositionDoc({ sequence: "21", vehicleId: "100000058", sectDist: 0.088, fullSectDist: 0.165, observedAt: "2026-10-18T18:10:53+09:00" });
  const rows58 = named("100000058", "18:11:10", [23, 37], [24, 92], [25, 136]);

  it("reaches the next stop from the rest of its section at 4 m/s, kept 20 s after the observation", () => {
    // Act
    const trajectory = toTrajectory(ahead58, "running", { ...ROUTE02, namedBuses: rows58 });

    // Assert
    // 77 m left at 4 m/s is 19 s, so the knot is held 20 s after the observation.
    expect(trajectory).toEqual([
      { atMs: at("18:10:53"), s: 20 + 0.088 / 0.165 },
      { atMs: at("18:11:13"), s: 21 },
      { atMs: at("18:11:47"), s: 22 },
      { atMs: at("18:12:42"), s: 23 },
    ]);
  });

  it("reaches an atStop bus's next stop from its departure over the whole section (hand-edited: its ord 20 row removed)", () => {
    // Arrange
    // Route 02 vehicle 100000058 at a stop at ord 19 at 18:08:33 (epoch 1792314531), first observed there.
    const position = jongroPositionDoc({ sequence: "19", vehicleId: "100000058", sectDist: 0, fullSectDist: 0.135, isAtStop: true, observedAt: "2026-10-18T18:08:33+09:00" });

    // Act
    const trajectory = toTrajectory(position, "atStop", { ...ROUTE02, namedBuses: named("100000058", "18:08:36", [21, 114]) });

    // Assert
    // 135 m at 4 m/s is 34 s after the 18:08:48 departure.
    expect(trajectory).toEqual([
      { atMs: at("18:08:33"), s: 18 },
      { atMs: at("18:08:48"), s: 18 },
      { atMs: at("18:09:22"), s: 19 },
      { atMs: at("18:10:30"), s: 20 },
    ]);
  });

  it("builds no later stop from distance", () => {
    // Act & Assert
    expect(toTrajectory(ahead58, "running", { ...ROUTE02, namedBuses: [] }).map((knot) => knot.s)).toEqual([20 + 0.088 / 0.165, 21]);
  });

  it.each([
    ["running", { sectDist: 0.088, fullSectDist: 0 }, [20]],
    ["atStop", { sectDist: 0, fullSectDist: 0, isAtStop: true }, [20, 20]],
  ] as const)("builds no %s next stop from distance when the section has no length", (status, fields, expected) => {
    // Arrange
    const position = jongroPositionDoc({ ...ahead58, ...fields });

    // Act & Assert
    expect(toTrajectory(position, status, { ...ROUTE02, namedBuses: [] }).map((knot) => knot.s)).toEqual(expected);
  });
});

// WHY: s is in stationIndex's index space and knot 0 stays in the bus's own section, floor(s) == stationIndex
// (agreed with skkuverse-app), even when TOPIS's sectDist reaches or passes fullSectDist.
describe("toTrajectory's first knot", () => {
  it.each([
    ["at the stop it passed", 0, 0.3, "running"],
    ["halfway", 0.15, 0.3, "running"],
    ["a meter short of the next stop", 0.299, 0.3, "running"],
    ["at the next stop's distance", 0.3, 0.3, "running"],
    ["past the next stop's distance", 0.31, 0.3, "running"],
    ["at a stop", 0.09, 0.3, "atStop"],
  ] as const)("keeps floor(s) at the station index for a bus %s", (_case, sectDist, fullSectDist, status) => {
    // Arrange
    const position = jongroPositionDoc({ sequence: "6", sectDist, fullSectDist, isAtStop: status === "atStop" });

    // Act
    const [first] = toTrajectory(position, status, { ...ROUTE07, namedBuses: [] });

    // Assert
    expect(Math.floor(first!.s)).toBe(5);
    expect(first!.s).toBeGreaterThanOrEqual(5);
  });
});

