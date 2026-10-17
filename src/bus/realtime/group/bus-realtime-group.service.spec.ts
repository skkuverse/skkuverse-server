/**
 * BusRealtimeGroupService over scripted clients and an in-memory bus_cache:
 * the HSSC group serves the cached HSSC buses and no ETAs, a Jongro group its
 * route's positions and arrival ETAs with each station's arrivals placed by
 * the registry's stations and its stations version, a missing registry route
 * is a 503, an unknown group is a 404, and meta carries the KST clock and the
 * bus count.
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
      data: { groupId: "hssc", buses: [{ stationIndex: 1, carNumber: "0000", estimatedTime: 30 }], stationEtas: [] },
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
    // WHY: arrivals (improve-jongro-realtime 3.1) and stationsVersion (5.4) are the fields this change adds.
    expect(group.data).toEqual({
      groupId: "jongro07",
      stationsVersion: versionOf("jongro07"),
      buses: [{ stationIndex: 5, carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }],
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
