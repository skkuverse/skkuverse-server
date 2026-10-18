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
 * stop re-based to TOPIS's observation time.
 */

import { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { BusRegistryRepository } from "../../registry/bus-registry.repository";
import { BusRegistryService } from "../../registry/bus-registry.service";
import type { RegistryRoute } from "../../registry/bus-registry.types";
import { jongroArrivalBus, jongroPositionDoc, noArrivalBus } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import {
  toJongroBusTracking,
  toNextStopInSec,
  toProgress,
  toStationEtas,
  toTrackedStatus,
  toVehicleBuses,
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
    });

    // Assert
    expect(tracking).toEqual({
      status: "running",
      vehicleId: "100000058",
      observedAt: "2026-10-17T19:12:02+09:00",
      crowding: "relaxed",
      isLastBus: false,
      progress: 0.114 / 0.251,
      segmentMeters: 251,
      nextStopInSec: 28,
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
    const tracking = toJongroBusTracking(position, { ...ROUTE07, nextStop, arrival: { state: "arriving", crowding: "relaxed", isLastBus: false } });

    // Assert
    expect(tracking).toEqual({
      status: "atStop",
      vehicleId: "100000103",
      observedAt: "2026-10-17T19:11:44+09:00",
      crowding: "relaxed",
      isLastBus: false,
      progress: 0,
      segmentMeters: 295,
      nextStopInSec: null,
    });
  });

  it("reads a waiting text only from the next stop's row, not from a later one", () => {
    // Act
    const tracking = toJongroBusTracking(running58, { ...ROUTE02, nextStop: undefined, arrival: { state: "waiting", crowding: null, isLastBus: true } });

    // Assert
    expect(tracking).toMatchObject({ status: "running", crowding: null, isLastBus: true, nextStopInSec: null });
  });

  it("serves no crowding and no last bus for a vehicle no row names", () => {
    // Act
    const tracking = toJongroBusTracking(running58, { ...ROUTE02, nextStop: undefined, arrival: undefined });

    // Assert
    expect(tracking).toMatchObject({ crowding: null, isLastBus: false, nextStopInSec: null });
  });
});
