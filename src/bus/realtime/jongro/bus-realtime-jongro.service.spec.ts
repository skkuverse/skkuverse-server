/**
 * BusRealtimeJongroService over a scripted client, an in-memory bus_cache and
 * a registry seeded from the committed snapshot: a route's tick stores its
 * arrivals and its bus positions under the route's code, places each bus on
 * the registry's stop (sequence and name), times its dwell at that stop, hands
 * the arrival list and turnaround stops to the registry sync (applied at the
 * third identical tick, never blocking the cache writes), and rejects on any
 * failure, a missing registry route included, so the poller registry counts it.
 */
jest.mock("../../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { jongroArrivalDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { asReal } from "../../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../../infra/clock";
import { jongroRoutes } from "../../bus.config";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { BusCacheRepository } from "../../cache/bus-cache.repository";
import { BusCacheService } from "../../cache/bus-cache.service";
import type { BusRegistryRepository } from "../../registry/bus-registry.repository";
import { BusRegistryService } from "../../registry/bus-registry.service";
import type { BusRealtimeJongroClient } from "./bus-realtime-jongro.client";
import { BusRealtimeJongroService } from "./bus-realtime-jongro.service";

const NOW = new Date("2026-10-20T01:00:00Z");
let now = NOW;
const clock: Clock = { now: () => now };
const route = (code: string) => jongroRoutes.find((r) => r.code === code)!;

let client: FakeBusRealtimeJongroClient;
let busCache: FakeBusCacheRepository;
let registryRepository: FakeBusRegistryRepository;
let service: BusRealtimeJongroService;

/** Runs every route's tick; returns their outcomes (a failed tick rejects). */
async function runTickAndFlush(): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(jongroRoutes.map((r) => service.refresh(r)));
}

beforeEach(async () => {
  jest.clearAllMocks();
  now = NOW;
  client = new FakeBusRealtimeJongroClient();
  busCache = new FakeBusCacheRepository();
  registryRepository = new FakeBusRegistryRepository();
  const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
  await registry.onModuleInit();
  const cache = new BusCacheService(asReal<BusCacheRepository>(busCache));
  service = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(client), cache, registry, clock);
});

describe("BusRealtimeJongroService.listArrivals", () => {
  it("initially returns undefined for uninitialized codes", async () => {
    // Act & Assert
    expect(await service.listArrivals("07")).toBeUndefined();
    expect(await service.listArrivals("02")).toBeUndefined();
  });

  it("maps bus list data correctly after a tick", async () => {
    // Arrange
    client.arrivals = [
      {
        stationId: "100900197",
        sequence: "1",
        stationName: "명륜새마을금고",
        carNumber: "5537",
        eventDate: "2024-01-01 12:00:00",
        stationNumber: "01504",
        eta: "3분후[1번째 전]",
        buses: [],
      },
    ];

    // Act
    await runTickAndFlush();

    // Assert
    const result = await service.listArrivals("07");
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      stationId: "100900197",
      sequence: "1",
      stationName: "명륜새마을금고",
      carNumber: "5537",
      stationNumber: "01504",
      eta: "3분후[1번째 전]",
    });
    expect(busCache.values.get("jongro_stations_07")).toEqual(result);
  });

  it("replaces the last arrivals when TOPIS lists none", async () => {
    // Arrange
    client.arrivals = [jongroArrivalDoc()];
    await service.refresh(route("07"));
    client.arrivals = [];

    // Act
    await service.refresh(route("07"));

    // Assert
    expect(await service.listArrivals("07")).toEqual([]);
    expect(busCache.values.get("jongro_stations_07")).toEqual([]);
  });
});

describe("BusRealtimeJongroService.listPositions", () => {
  it("maps location data with station mapping", async () => {
    // Arrange
    client.sightings = [{ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", turnaroundStationId: "100900028" }];

    // Act
    await runTickAndFlush();

    // Assert
    const result = await service.listPositions("07");
    expect(result).toHaveLength(1);
    // That stop is TOPIS ord 6 of route 07; the registry mirrors TOPIS order.
    expect(result![0]).toMatchObject({
      sequence: "6",
      stationName: "명륜새마을금고",
      carNumber: "5537",
      latitude: "37.587",
      longitude: "126.998",
    });
    expect(result![0]!.estimatedTime).toBeDefined();
    expect(busCache.values.get("jongro_locations_07")).toEqual(result);
  });

  it("drops a bus at a stop the registry does not list", async () => {
    // Arrange
    client.sightings = [{ stationId: "999999999", latitude: "37.5", longitude: "126.9", carNumber: "0001", turnaroundStationId: "100900028" }];

    // Act
    await service.refresh(route("07"));

    // Assert
    expect(await service.listPositions("07")).toEqual([]);
  });

  it("times a bus's dwell at its stop from the first tick that saw it there", async () => {
    // Arrange
    client.sightings = [{ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", turnaroundStationId: "100900028" }];
    await service.refresh(route("07"));
    now = new Date(NOW.getTime() + 80_000);

    // Act
    await service.refresh(route("07"));

    // Assert
    expect((await service.listPositions("07"))![0]).toMatchObject({
      estimatedTime: 80,
      eventDate: NOW.toISOString(),
      recordTime: NOW.toISOString(),
    });
  });
});

describe("BusRealtimeJongroService.refresh", () => {
  describe("error handling", () => {
    it("rejects each route's tick on an API error; state stays undefined", async () => {
      // Arrange
      client.failWith = new Error("Network error");

      // Act
      const outcomes = await runTickAndFlush();

      // Assert
      expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
      client.failWith = null;
      expect(await service.listArrivals("07")).toBeUndefined();
    });

    it("rejects when the bus_cache write fails", async () => {
      // Arrange
      client.arrivals = [];
      busCache.failWith = new Error("mongo down");

      // Act & Assert
      await expect(service.refresh(route("07"))).rejects.toThrow("mongo down");
    });

    it("writes nothing when TOPIS fails", async () => {
      // Arrange
      client.failWith = new Error("TOPIS error code (jongro 07 location)");

      // Act & Assert
      await expect(service.refresh(route("07"))).rejects.toThrow("TOPIS error code");
      expect([...busCache.values.keys()]).toEqual([]);
    });

    it("handles empty itemList → empty list array", async () => {
      // Arrange
      client.arrivals = [];

      // Act
      await runTickAndFlush();

      // Assert
      expect(await service.listArrivals("07")).toHaveLength(0);
    });
  });
});

// WHY: TOPIS lists no bus overnight; a written empty list keeps the key alive, so a missing key means the
// poller stopped writing (bus.cache.missing) rather than a quiet night.
describe("BusRealtimeJongroService.refresh with no bus listed", () => {
  it("writes both of the route's keys as empty lists", async () => {
    // Arrange
    client.arrivals = [];
    client.sightings = [];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(Object.fromEntries(busCache.values)).toEqual({ jongro_stations_02: [], jongro_locations_02: [] });
  });
});

// WHY: the poller follows TOPIS's stop list through the registry (improve-jongro-realtime D9, D10).
describe("BusRealtimeJongroService.refresh and the registry", () => {
  const arrivalsOf = (topisIds: readonly string[]): JongroArrivalDoc[] =>
    topisIds.map((stationId, index) => jongroArrivalDoc({ stationId, sequence: String(index + 1), stationName: `stop ${stationId}`, stationNumber: `0${index}` }));
  const storedIdsOf = (routeId: string) => registryRepository.routes.get(routeId)!.stations.map((station) => station.topisId);

  it("applies a drifted stop list at the third tick, and the next tick places buses by it", async () => {
    // Arrange
    const ids = [...storedIdsOf("jongro07"), "100000999"];
    client.arrivals = arrivalsOf(ids);

    // Act
    for (let i = 0; i < 3; i++) await service.refresh(route("07"));
    client.sightings = [{ stationId: "100000999", latitude: "37.5", longitude: "127.0", carNumber: "0009" }];
    await service.refresh(route("07"));

    // Assert
    expect(storedIdsOf("jongro07")).toEqual(ids);
    expect((await service.listPositions("07"))!.map((p) => [p.sequence, p.stationName])).toEqual([["23", "stop 100000999"]]);
    expect(new Set(client.positionsUrls)).toEqual(new Set([route("07").positionsUrl]));
  });

  it("keeps the stored turnaround stop when the position rows name none", async () => {
    // Arrange
    client.arrivals = arrivalsOf([...storedIdsOf("jongro07"), "100000999"]);
    client.sightings = [{ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537" }];

    // Act
    for (let i = 0; i < 3; i++) await service.refresh(route("07"));

    // Assert
    expect(registryRepository.routes.get("jongro07")!.turnaroundTopisId).toBe("100900028");
  });

  it("still writes both keys when the registry holds a change", async () => {
    // Arrange
    client.arrivals = arrivalsOf(storedIdsOf("jongro07").map((id, index) => (index < 10 ? `OTHER${index}` : id)));

    // Act
    for (let i = 0; i < 3; i++) await service.refresh(route("07"));

    // Assert
    expect(storedIdsOf("jongro07")[0]).toBe("100900220");
    expect(busCache.values.get("jongro_stations_07")).toHaveLength(22);
    expect(busCache.values.get("jongro_locations_07")).toEqual([]);
  });

  it("rejects the tick and writes nothing when the route's registry document is missing", async () => {
    // Arrange
    registryRepository.routes.delete("jongro02");

    // Act & Assert
    await expect(service.refresh(route("02"))).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE" });
    expect([...busCache.values.keys()]).toEqual([]);
  });
});
