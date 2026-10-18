/**
 * BusRealtimeGroupService over scripted clients and an in-memory bus_cache:
 * the HSSC group serves the cached HSSC buses and no ETAs, a Jongro group its
 * route's positions and arrival ETAs with each station's arrivals placed by
 * the registry's stations and its stations version, a missing registry route
 * is a 503, an unknown group is a 404, and meta carries the KST clock and the
 * bus count. Every bus says its kind: HSSC buses are estimated, and each
 * Jongro bus is tracked from its cached position joined with its vehicle's
 * arrival rows (waiting, at a stop or running, with its countdown); a waiting
 * vehicle's arrivals read waiting, and a position a full section behind its
 * arrival rows is served running.
 */
jest.mock("../../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeHsscClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-hssc.client.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import {
  hsscBusDoc,
  jongroArrivalBus,
  jongroArrivalDoc,
  jongroPositionDoc,
  noArrivalBus,
} from "../../../../__tests__/helpers/bus/bus-cache-docs";
import type { Clock } from "../../../infra/clock";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRegistryRepository } from "../../registry/bus-registry.repository";
import { BusRegistryService } from "../../registry/bus-registry.service";
import { BusRealtimeArrivalService } from "../arrival/bus-realtime-arrival.service";
import type { BusRealtimeHsscClient } from "../hssc/bus-realtime-hssc.client";
import { BusRealtimeHsscService } from "../hssc/bus-realtime-hssc.service";
import type { BusRealtimeJongroClient } from "../jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "../jongro/bus-realtime-jongro.service";
import { BusRealtimeGroupService } from "./bus-realtime-group.service";

const NOW = new Date("2026-10-20T01:00:00Z");
const clock: Clock = { now: () => NOW };

let busCache: FakeBusCacheRepository;
let registryRepository: FakeBusRegistryRepository;
let service: BusRealtimeGroupService;
const versionOf = (routeId: string) => registryRepository.routes.get(routeId)!.stationsVersion;

beforeEach(async () => {
  busCache = new FakeBusCacheRepository();
  registryRepository = new FakeBusRegistryRepository();
  const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
  await registry.onModuleInit();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, clock);
  const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cache, registry, clock);
  service = new BusRealtimeGroupService(hssc, jongro, new BusRealtimeArrivalService(), clock);
});

describe("BusRealtimeGroupService.getGroup", () => {
  it("serves the cached HSSC buses with no station ETAs", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBusDoc({ sequence: "2", carNumber: "0000", estimatedTime: 30 })]);

    // Act
    const group = await service.getGroup("hssc");

    // Assert
    expect(group).toEqual({
      // WHY: kind is what add-jongro-bus-positions adds to every bus (task 2.2).
      data: { groupId: "hssc", buses: [{ stationIndex: 1, carNumber: "0000", estimatedTime: 30, kind: "estimated" }], stationEtas: [] },
      meta: { currentTime: "10:00 AM", totalBuses: 1 },
    });
  });

  it("serves a Jongro route's positions and its arrival ETAs by ord", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "6", carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }),
    ]);
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ stationId: "100900220", sequence: "1", eta: "3분후[2번째 전]" }),
      jongroArrivalDoc({ stationId: "100000424", sequence: "3", eta: "", buses: [noArrivalBus(), noArrivalBus()] }),
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    // WHY: arrivals (improve-jongro-realtime 3.1) and stationsVersion (5.4) are the fields this change adds;
    // kind and tracked are add-jongro-bus-positions' (task 2.2), the bus's crowding from the ord 1 row naming it.
    expect(group.data).toEqual({
      groupId: "jongro07",
      stationsVersion: versionOf("jongro07"),
      buses: [
        {
          stationIndex: 5,
          carNumber: "5537",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000103",
            observedAt: "2026-10-20T10:00:00+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.5,
            segmentMeters: 300,
            nextStopInSec: null,
          },
        },
      ],
      stationEtas: [
        {
          stationIndex: 0,
          eta: "3분후[2번째 전]",
          arrivals: [
            {
              minutes: 3,
              stopsAway: 1,
              state: "running",
              isLastBus: false,
              carNumber: "5537",
              crowding: "relaxed",
              passengerCount: 9,
              message: "3분후[2번째 전]",
            },
          ],
        },
      ],
    });
  });

  it("serves a station's first and second bus in that order, judged on the route's seat count", async () => {
    // Arrange
    busCache.values.set("jongro_stations_08", [
      jongroArrivalDoc({
        stationId: "100000102",
        sequence: "15",
        eta: "곧 도착",
        buses: [
          jongroArrivalBus({ arrmsg: "곧 도착", traTime: 112, staOrd: 15, sectOrd: 15, plainNo: "서울70사5504", rerideNum: 6 }),
          jongroArrivalBus({ arrmsg: "7분50초후[4번째 전]", traTime: 470, staOrd: 15, sectOrd: 11, plainNo: "서울70사5535", rerideNum: 28 }),
        ],
      }),
    ]);

    // Act
    const group = await service.getGroup("jongro08");

    // Assert
    expect(group.data.stationEtas).toEqual([
      {
        stationIndex: 14,
        eta: "곧 도착",
        arrivals: [
          {
            minutes: null,
            stopsAway: 0,
            state: "arriving",
            isLastBus: false,
            carNumber: "5504",
            crowding: "relaxed",
            passengerCount: 6,
            message: "곧 도착",
          },
          {
            minutes: 8,
            stopsAway: 4,
            state: "running",
            isLastBus: false,
            carNumber: "5535",
            crowding: "crowded",
            passengerCount: 28,
            message: "7분50초후[4번째 전]",
          },
        ],
      },
    ]);
  });

  it("serves only the first bus when TOPIS sends no second text", async () => {
    // Arrange
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ buses: [jongroArrivalBus({ arrmsg: "3분후[2번째 전]" }), noArrivalBus({ arrmsg: "" })] }),
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    expect(group.data.stationEtas[0]!.arrivals.map((arrival) => arrival.message)).toEqual(["3분후[2번째 전]"]);
  });

  it("serves an empty group when neither bus_cache nor memory has buses", async () => {
    // Act & Assert
    expect((await service.getGroup("jongro08")).data).toEqual({ groupId: "jongro08", buses: [], stationEtas: [], stationsVersion: versionOf("jongro08") });
  });

  it("refuses an unknown group with GROUP_NOT_FOUND", async () => {
    // Act & Assert
    await expect(service.getGroup("nope")).rejects.toMatchObject({
      code: "GROUP_NOT_FOUND",
      message: "Unknown groupId: nope",
      httpStatus: 404,
    });
  });
});

// WHY: the realtime response names the stations version it was placed by, so the app can tell its config is stale
// (improve-jongro-realtime D10); without a stored route there is nothing to place by (D7).
describe("BusRealtimeGroupService.getGroup and the registry", () => {
  it("places arrivals by the stored stations and serves their version", async () => {
    // Arrange
    const doc = registryRepository.routes.get("jongro07")!;
    doc.stations = [{ topisId: "NEW", arsId: "09999", stationName: "새 정류장", sequence: 1 }, ...doc.stations.map((s) => ({ ...s, sequence: s.sequence + 1 }))];
    doc.stationsVersion = "moved-by-one";
    const freshRegistry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
    const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
    const jongro = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(new FakeBusRealtimeJongroClient()), cache, freshRegistry, clock);
    const hssc = new BusRealtimeHsscService(asReal<BusRealtimeHsscClient>(new FakeBusRealtimeHsscClient()), cache, clock);
    const fresh = new BusRealtimeGroupService(hssc, jongro, new BusRealtimeArrivalService(), clock);
    busCache.values.set("jongro_stations_07", [jongroArrivalDoc({ stationId: "100900220", sequence: "2", eta: "곧 도착" })]);

    // Act
    const group = await fresh.getGroup("jongro07");

    // Assert
    expect(group.data.stationsVersion).toBe("moved-by-one");
    expect(group.data.stationEtas.map((eta) => [eta.stationIndex, eta.eta])).toEqual([[1, "곧 도착"]]);
  });

  it("serves no stations version for the HSSC group", async () => {
    // Act & Assert
    expect((await service.getGroup("hssc")).data).not.toHaveProperty("stationsVersion");
  });

  it("refuses a Jongro group whose registry route is missing with a 503", async () => {
    // Arrange
    registryRepository.routes.delete("jongro02");

    // Act & Assert
    await expect(service.getGroup("jongro02")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
  });
});

// WHY: each Jongro bus is tracked by joining its cached position with its vehicle's arrival rows at serve time
// (add-jongro-bus-positions D4). The rows are the 2026-10-17 production capture's (pos_/arr_<busRouteId>_<epoch>).
describe("BusRealtimeGroupService.getGroup tracked buses", () => {
  const trackedOf = async (groupId: string) => (await service.getGroup(groupId)).data.buses.map((bus) => ("tracked" in bus ? bus.tracked : bus.kind));

  it("serves a running bus with its countdown re-based to its observation (종로02 vehicle 100000058, epoch 1792231942)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_02", [
      jongroPositionDoc({
        sequence: "17",
        stationName: "종로2가",
        stationId: "100000104",
        carNumber: "2008",
        estimatedTime: 0,
        latitude: "37.576595",
        longitude: "126.985792",
        vehicleId: "100000058",
        sectDist: 0.114,
        fullSectDist: 0.251,
        isAtStop: false,
        observedAt: "2026-10-17T19:12:02+09:00",
        isStationary: false,
      }),
    ]);
    busCache.values.set("jongro_stations_02", [
      jongroArrivalDoc({
        stationId: "100900172",
        sequence: "18",
        eventDate: "2026-10-17 19:12:10.0",
        eta: "곧 도착",
        buses: [
          jongroArrivalBus({ vehId: "100000058", plainNo: "서울75사2008", staOrd: 18, sectOrd: 18, traTime: 20, arrmsg: "곧 도착", rerideDiv: 2, rerideNum: 1 }),
          noArrivalBus({ staOrd: 18 }),
        ],
      }),
      jongroArrivalDoc({
        stationId: "100900203",
        sequence: "19",
        eventDate: "2026-10-17 19:12:10.0",
        eta: "1분36초후[1번째 전]",
        buses: [
          jongroArrivalBus({ vehId: "100000058", plainNo: "서울75사2008", staOrd: 19, sectOrd: 18, traTime: 96, arrmsg: "1분36초후[1번째 전]", rerideDiv: 2, rerideNum: 30 }),
          noArrivalBus({ staOrd: 19 }),
        ],
      }),
    ]);

    // Act
    const group = await service.getGroup("jongro02");

    // Assert
    expect(group.data.buses).toEqual([
      {
        stationIndex: 16,
        carNumber: "2008",
        estimatedTime: 0,
        latitude: "37.576595",
        longitude: "126.985792",
        kind: "tracked",
        tracked: {
          status: "running",
          vehicleId: "100000058",
          observedAt: "2026-10-17T19:12:02+09:00",
          crowding: "relaxed",
          isLastBus: false,
          progress: 0.114 / 0.251,
          segmentMeters: 251,
          nextStopInSec: 28,
        },
      },
    ]);
  });

  it("serves a bus with stopFlag 1 at a stop (종로07 vehicle 100000103, epoch 1792231921)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "14", stationId: "100900043", carNumber: "5537", vehicleId: "100000103", sectDist: 0, fullSectDist: 0.295, isAtStop: true, observedAt: "2026-10-17T19:11:44+09:00" }),
    ]);
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        stationId: "100000125",
        sequence: "15",
        eventDate: "2026-10-17 19:11:46.0",
        eta: "곧 도착",
        buses: [jongroArrivalBus({ vehId: "100000103", staOrd: 15, sectOrd: 15, traTime: 61, arrmsg: "곧 도착", rerideDiv: 2, rerideNum: 0 }), noArrivalBus({ staOrd: 15 })],
      }),
    ]);

    // Act & Assert
    expect(await trackedOf("jongro07")).toEqual([
      { status: "atStop", vehicleId: "100000103", observedAt: "2026-10-17T19:11:44+09:00", crowding: "relaxed", isLastBus: false },
    ]);
  });

  it("serves a bus standing still at its origin and named on no row as waiting (종로02 vehicle 100000018, epoch 1792231942)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_02", [
      jongroPositionDoc({ sequence: "1", stationId: "100900204", carNumber: "5512", vehicleId: "100000018", sectDist: 0.043, fullSectDist: 0.259, observedAt: "2026-10-17T19:11:58+09:00", isStationary: true }),
    ]);
    busCache.values.set("jongro_stations_02", [
      jongroArrivalDoc({ stationId: "100900202", sequence: "2", eta: "출발대기", buses: [noArrivalBus({ staOrd: 2, arrmsg: "출발대기" }), noArrivalBus({ staOrd: 2, arrmsg: "출발대기" })] }),
    ]);

    // Act & Assert
    expect(await trackedOf("jongro02")).toEqual([
      { status: "waiting", vehicleId: "100000018", observedAt: "2026-10-17T19:11:58+09:00", crowding: null, isLastBus: false },
    ]);
  });

  it("serves a bus whose next stop reads 출발대기 as waiting (종로07 vehicle 100000035, epoch 1792232187)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "1", stationId: "100900220", carNumber: "5536", vehicleId: "100000035", sectDist: 0, fullSectDist: 0.201, observedAt: "2026-10-17T19:16:06+09:00", isStationary: false }),
    ]);
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        stationId: "100900221",
        sequence: "2",
        eventDate: "2026-10-17 19:16:06.0",
        eta: "출발대기",
        buses: [jongroArrivalBus({ vehId: "100000035", plainNo: "서울70사5536", staOrd: 2, sectOrd: 2, traTime: 228, arrmsg: "출발대기", rerideDiv: 0, rerideNum: 0 }), noArrivalBus({ staOrd: 2 })],
      }),
    ]);

    // Act & Assert
    expect(await trackedOf("jongro07")).toEqual([
      { status: "waiting", vehicleId: "100000035", observedAt: "2026-10-17T19:16:06+09:00", crowding: null, isLastBus: false },
    ]);
  });

  it("never serves a bus at the last index as running (hand-edited: no 2026-10-17 row reached 종로02's ord 27)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_02", [
      jongroPositionDoc({ sequence: "27", stationId: "100900204", carNumber: "5509", vehicleId: "100000015", sectDist: 0, fullSectDist: 0.1, isAtStop: false, observedAt: "2026-10-17T19:11:49+09:00" }),
    ]);

    // Act
    const group = await service.getGroup("jongro02");

    // Assert
    expect(group.data.buses.map((bus) => [bus.stationIndex, "tracked" in bus && bus.tracked.status])).toEqual([[26, "atStop"]]);
  });
});

// WHY: production showed route 02's 2009 waiting at its origin while its own arrivals read arriving at stop 1
// (add-jongro-bus-positions D7). The rows are the 2026-10-17 capture's (pos_/arr_<busRouteId>_<epoch>).
describe("BusRealtimeGroupService.getGroup waiting arrivals and lagging positions", () => {
  it("serves a waiting vehicle's arrivals as waiting and leaves other vehicles' (종로02 vehicle 100000018, epoch 1792232472)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_02", [
      jongroPositionDoc({
        sequence: "1",
        stationId: "100900204",
        carNumber: "5512",
        latitude: "37.588707",
        longitude: "126.990208",
        vehicleId: "100000018",
        sectDist: 0.031,
        fullSectDist: 0.259,
        observedAt: "2026-10-17T19:21:01+09:00",
        isStationary: true,
      }),
    ]);
    const bus18 = { vehId: "100000018", plainNo: "서울70사5512", sectOrd: 2, rerideDiv: 2, rerideNum: 1 };
    const row = (stationId: string, sequence: string, buses: ReturnType<typeof jongroArrivalBus>[]) =>
      jongroArrivalDoc({ stationId, sequence, eventDate: "2026-10-17 19:21:00.0", eta: buses[0]!.arrmsg, buses });
    busCache.values.set("jongro_stations_02", [
      row("100900202", "2", [jongroArrivalBus({ ...bus18, staOrd: 2, traTime: 11, arrmsg: "곧 도착" }), noArrivalBus({ staOrd: 2, arrmsg: "출발대기" })]),
      row("100900045", "3", [jongroArrivalBus({ ...bus18, staOrd: 3, traTime: 107, arrmsg: "1분47초후[1번째 전]" }), noArrivalBus({ staOrd: 3, arrmsg: "출발대기" })]),
      row("100900121", "13", [
        jongroArrivalBus({ vehId: "100000015", plainNo: "서울70사5509", staOrd: 13, sectOrd: 13, traTime: 77, arrmsg: "곧 도착", rerideDiv: 2, rerideNum: 5 }),
        jongroArrivalBus({ ...bus18, staOrd: 13, traTime: 735, arrmsg: "12분15초후[11번째 전]" }),
      ]),
    ]);

    // Act
    const group = await service.getGroup("jongro02");

    // Assert
    expect(group.data.buses.map((bus) => "tracked" in bus && bus.tracked.status)).toEqual(["waiting"]);
    expect(group.data.stationEtas.map((eta) => [eta.stationIndex, eta.arrivals.map((a) => [a.carNumber, a.state, a.minutes, a.message])])).toEqual([
      [1, [["5512", "waiting", null, "곧 도착"], [null, "waiting", null, "출발대기"]]],
      [2, [["5512", "waiting", null, "1분47초후[1번째 전]"], [null, "waiting", null, "출발대기"]]],
      [12, [["5509", "arriving", null, "곧 도착"], ["5512", "waiting", null, "12분15초후[11번째 전]"]]],
    ]);
    expect(group.data.stationEtas[0]!.arrivals[0]).toMatchObject({ stopsAway: 0, crowding: "relaxed", passengerCount: 1 });
  });

  it("serves a position a section behind its arrival rows as running (종로07 vehicle 100000035, position 19:22:58, rows 19:23:36)", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({
        sequence: "5",
        stationId: "100000421",
        carNumber: "5536",
        latitude: "37.585896",
        longitude: "126.996981",
        vehicleId: "100000035",
        sectDist: 0,
        fullSectDist: 0.225,
        isAtStop: true,
        observedAt: "2026-10-17T19:22:58+09:00",
        isStationary: false,
      }),
    ]);
    const bus35 = { vehId: "100000035", plainNo: "서울70사5536", sectOrd: 7, rerideDiv: 2, rerideNum: 3 };
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        stationId: "100900031",
        sequence: "7",
        eventDate: "2026-10-17 19:23:36.0",
        eta: "곧 도착",
        buses: [jongroArrivalBus({ ...bus35, staOrd: 7, traTime: 38, arrmsg: "곧 도착" }), noArrivalBus({ staOrd: 7, arrmsg: "출발대기" })],
      }),
      jongroArrivalDoc({
        stationId: "100900017",
        sequence: "8",
        eventDate: "2026-10-17 19:23:36.0",
        eta: "1분23초후[1번째 전]",
        buses: [jongroArrivalBus({ ...bus35, staOrd: 8, traTime: 83, arrmsg: "1분23초후[1번째 전]" }), noArrivalBus({ staOrd: 8, arrmsg: "출발대기" })],
      }),
    ]);

    // Act
    const group = await service.getGroup("jongro07");

    // Assert
    expect(group.data.buses).toEqual([
      {
        stationIndex: 4,
        carNumber: "5536",
        estimatedTime: 0,
        latitude: "37.585896",
        longitude: "126.996981",
        kind: "tracked",
        tracked: {
          status: "running",
          vehicleId: "100000035",
          observedAt: "2026-10-17T19:22:58+09:00",
          crowding: "relaxed",
          isLastBus: false,
          progress: 0,
          segmentMeters: 225,
          nextStopInSec: null,
        },
      },
    ]);
  });
});
