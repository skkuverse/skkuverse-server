/**
 * BusRealtimeJongroService over a scripted client, an in-memory bus_cache and
 * a registry holding the routes stored on 2026-10-17: a route's tick stores
 * its arrivals and its bus positions under the route's code, places each bus
 * on the registry's stop (sequence and name), times its dwell at that stop,
 * hands the arrival list and turnaround stops to the registry sync (applied at
 * the third identical tick, never blocking the cache writes), and rejects on
 * any failure, so the poller registry counts it. A route with no registry
 * document writes no bus_cache key: its tick hands both lists to the
 * registry's bootstrap and resolves (isolate-api-from-pollers D2).
 * Each stored bus keeps its vehicle fields, sits at its section ord, and is
 * stationary when its vehicle stood still since the poller's previous
 * observation of it (never on the first after a restart), or when it idles at
 * its origin: at index 0 with lastStTm 0 and not moved 10 m since the previous
 * observation, a frozen observation time included, or at its first
 * observation off a stop. A bus at a stop keeps since when its vehicle has
 * stood there, from the poller's memory (add-jongro-bus-trajectory).
 */
jest.mock("../../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusCacheRepository } from "../../../../__tests__/helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../../../__tests__/helpers/fakes/bus/bus-realtime-jongro.client.fake";
import type { FakeBusRegistryRepository } from "../../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { storedBusRegistryRepository } from "../../../../__tests__/helpers/bus/bus-registry";
import { jongroArrivalDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { jongroSighting } from "../../../../__tests__/helpers/bus/jongro-sighting";
import originIdling from "../../../../__tests__/nest/bus/fixtures/jongro02-origin-idling-sightings.json";
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
import type { JongroBusSighting } from "./bus-realtime-jongro.types";

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
  registryRepository = storedBusRegistryRepository();
  const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
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
    client.sightings = [jongroSighting({ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", sectOrd: 6 })];

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
    client.sightings = [jongroSighting({ stationId: "999999999", latitude: "37.5", longitude: "126.9", carNumber: "0001" })];

    // Act
    await service.refresh(route("07"));

    // Assert
    expect(await service.listPositions("07")).toEqual([]);
  });

  it("times a bus's dwell at its stop from the first tick that saw it there", async () => {
    // Arrange
    client.sightings = [jongroSighting({ stationId: "100900197", latitude: "37.587", longitude: "126.998", carNumber: "5537", sectOrd: 6 })];
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

// WHY: every role reads bus_cache only, so combined answers as an api replica does (ADR 0012, D1).
describe("BusRealtimeJongroService reads after its own tick", () => {
  it("serves no arrivals once the bus_cache entry is gone, though a tick filled the process's memory", async () => {
    // Arrange
    client.arrivals = [jongroArrivalDoc()];
    await service.refresh(route("07"));
    busCache.values.delete("jongro_stations_07");

    // Act
    const arrivals = await service.listArrivals("07");

    // Assert
    expect(arrivals).toBeUndefined();
  });

  it("serves no positions once the bus_cache entry is gone, though a tick filled the process's memory", async () => {
    // Arrange
    client.sightings = [jongroSighting({ stationId: "100900197", sectOrd: 6 })];
    await service.refresh(route("07"));
    busCache.values.delete("jongro_locations_07");

    // Act
    const positions = await service.listPositions("07");

    // Assert
    expect(positions).toBeUndefined();
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
    client.sightings = [jongroSighting({ stationId: "100000999", latitude: "37.5", longitude: "127.0", carNumber: "0009", turnaroundStationId: undefined, sectOrd: 23 })];
    await service.refresh(route("07"));

    // Assert
    expect(storedIdsOf("jongro07")).toEqual(ids);
    expect((await service.listPositions("07"))!.map((p) => [p.sequence, p.stationName])).toEqual([["23", "stop 100000999"]]);
    expect(new Set(client.positionsRouteIds)).toEqual(new Set([route("07").busRouteId]));
  });

  it("keeps the stored turnaround stop when the position rows name none", async () => {
    // Arrange
    client.arrivals = arrivalsOf([...storedIdsOf("jongro07"), "100000999"]);
    client.sightings = [jongroSighting({ turnaroundStationId: undefined })];

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

});

// WHY: a fresh database gets its routes from TOPIS through the poller, not a snapshot (isolate-api-from-pollers D2).
describe("BusRealtimeJongroService.refresh for a route with no registry document", () => {
  const TURNAROUND_08 = "100000153";
  const arrivalsOf = (topisIds: readonly string[]): JongroArrivalDoc[] =>
    topisIds.map((stationId, index) => jongroArrivalDoc({ stationId, sequence: String(index + 1), stationName: `stop ${stationId}`, stationNumber: `0${index}` }));
  let stored08: string[];

  beforeEach(() => {
    stored08 = registryRepository.routes.get("jongro08")!.stations.map((station) => station.topisId);
    registryRepository.routes.delete("jongro08");
    client.arrivals = arrivalsOf(stored08);
    client.sightings = [jongroSighting({ stationId: stored08[3]!, sectOrd: 4, turnaroundStationId: TURNAROUND_08 })];
  });

  it("fetches both lists, writes no bus_cache key and resolves", async () => {
    // Act
    const outcome = service.refresh(route("08"));

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(new Set(client.positionsRouteIds)).toEqual(new Set([route("08").busRouteId]));
    expect([...busCache.values.keys()]).toEqual([]);
    expect(registryRepository.routes.has("jongro08")).toBe(false);
  });

  it("inserts the route from TOPIS at the third tick, and the next tick writes both keys by it", async () => {
    // Act
    for (let i = 0; i < 3; i++) await service.refresh(route("08"));
    const keysAfterThird = [...busCache.values.keys()];
    await service.refresh(route("08"));

    // Assert
    expect(keysAfterThird).toEqual([]);
    expect(registryRepository.routes.get("jongro08")).toMatchObject({ turnaroundTopisId: TURNAROUND_08 });
    expect(registryRepository.routes.get("jongro08")!.stations.map((station) => station.topisId)).toEqual(stored08);
    expect(busCache.values.get("jongro_stations_08")).toHaveLength(stored08.length);
    expect((await service.listPositions("08"))!.map((p) => p.sequence)).toEqual(["4"]);
  });

  it("inserts nothing at night, when no bus names a turnaround stop", async () => {
    // Arrange
    client.sightings = [];

    // Act
    for (let i = 0; i < 3; i++) await service.refresh(route("08"));

    // Assert
    expect(registryRepository.routes.has("jongro08")).toBe(false);
    expect([...busCache.values.keys()]).toEqual([]);
  });

  it("still rejects when TOPIS fails", async () => {
    // Arrange
    client.failWith = new Error("TOPIS error code (jongro 08 list)");

    // Act & Assert
    await expect(service.refresh(route("08"))).rejects.toThrow("TOPIS error code");
    expect(registryRepository.routes.has("jongro08")).toBe(false);
  });
});

// WHY: the realtime response tracks each bus from its stored vehicle fields (add-jongro-bus-positions D2, D3).
describe("BusRealtimeJongroService.refresh vehicle tracking", () => {
  // Route 02 vehicle 100000018 idling at ord 1 (pos_100900008_1792231921 and _1792231942, 2026-10-17 capture).
  const idle18 = (observedAt: string, sectDist = 0.043) =>
    jongroSighting({
      stationId: "100900204",
      latitude: "37.588444",
      longitude: "126.990028",
      carNumber: "5512",
      turnaroundStationId: "100900121",
      vehicleId: "100000018",
      sectOrd: 1,
      sectDist,
      fullSectDist: 0.259,
      isAtStop: false,
      observedAt,
    });
  const stationaryOf = async () => (await service.listPositions("02"))!.map((p) => p.isStationary);

  it("stores each bus's vehicle fields at its section ord", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00")];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(busCache.values.get("jongro_locations_02")).toEqual([
      {
        sequence: "1",
        stationName: "성균관대학교",
        carNumber: "5512",
        eventDate: NOW.toISOString(),
        estimatedTime: 0,
        stationId: "100900204",
        latitude: "37.588444",
        longitude: "126.990028",
        recordTime: NOW.toISOString(),
        vehicleId: "100000018",
        sectDist: 0.043,
        fullSectDist: 0.259,
        isAtStop: false,
        observedAt: "2026-10-17T19:11:40+09:00",
        isStationary: false,
      },
    ]);
  });

  it("places a bus at the loop end by its section ord, not the stop's first ord", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00", 0)];
    client.sightings[0]!.sectOrd = 27;

    // Act
    await service.refresh(route("02"));

    // Assert
    expect((await service.listPositions("02"))!.map((p) => p.sequence)).toEqual(["27"]);
  });

  it("marks a vehicle stationary at its second observation without a move", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00")];
    await service.refresh(route("02"));
    client.sightings = [idle18("2026-10-17T19:11:58+09:00")];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(await stationaryOf()).toEqual([true]);
  });

  it("does not mark it stationary after a 12 m move", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:14:40+09:00", 0.044)];
    await service.refresh(route("02"));
    client.sightings = [idle18("2026-10-17T19:14:58+09:00", 0.056)];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(await stationaryOf()).toEqual([false]);
  });

  it("forgets every vehicle on a restart, so the first observation is never stationary", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00")];
    await service.refresh(route("02"));
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
    service = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(client), new BusCacheService(asReal<BusCacheRepository>(busCache)), registry, clock);
    client.sightings = [idle18("2026-10-17T19:11:58+09:00")];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(await stationaryOf()).toEqual([false]);
  });

  it("forgets a vehicle missing from a tick", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00")];
    await service.refresh(route("02"));
    client.sightings = [];
    await service.refresh(route("02"));
    client.sightings = [idle18("2026-10-17T19:12:19+09:00")];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(await stationaryOf()).toEqual([false]);
  });

  it("keeps each route's vehicles apart", async () => {
    // Arrange
    client.sightings = [idle18("2026-10-17T19:11:40+09:00")];
    await service.refresh(route("02"));
    // The same vehicle id on 07 moved, so 02 would read it as moving if the routes shared one memory.
    client.sightings = [jongroSighting({ vehicleId: "100000018", sectOrd: 1, stationId: "100900220", sectDist: 0.2, observedAt: "2026-10-17T19:11:58+09:00" })];
    await service.refresh(route("07"));
    client.sightings = [idle18("2026-10-17T19:11:58+09:00")];

    // Act
    await service.refresh(route("02"));

    // Assert
    expect(await stationaryOf()).toEqual([true]);
  });
});

// WHY: TOPIS stops advancing dataTm for a bus idling at its origin, so the still-across-two-observations rule
// alone served bus 2009 running on 2026-10-18; lastStTm 0 marks the origin.
describe("BusRealtimeJongroService.refresh origin idling", () => {
  const { firstAtOrigin, creepingOut, leftOrigin } = originIdling.vehicle100000018;
  const stationaryAcross = async (ticks: JongroBusSighting[]) => {
    const stationary: boolean[] = [];
    for (const sighting of ticks) {
      client.sightings = [sighting];
      await service.refresh(route("02"));
      stationary.push((await service.listPositions("02"))![0]!.isStationary);
    }
    return stationary;
  };

  it("marks a vehicle at the origin with lastStTm 0 stationary at its first observation", async () => {
    // Act
    const stationary = await stationaryAcross([firstAtOrigin]);

    // Assert
    expect(stationary).toEqual([true]);
  });

  it("keeps a vehicle stationary while TOPIS repeats its observation time at the origin", async () => {
    // Act
    const stationary = await stationaryAcross(originIdling.frozen2009);

    // Assert
    expect(stationary).toEqual([true, false, true]);
  });

  it("does not mark a vehicle creeping 23 m out of the origin stationary, and marks it again after 8 m", async () => {
    // Act
    const stationary = await stationaryAcross(creepingOut);

    // Assert
    expect(stationary).toEqual([true, false, true]);
  });

  it("does not mark a vehicle stationary once it left the origin", async () => {
    // Act
    const stationary = await stationaryAcross([creepingOut[2]!, leftOrigin]);

    // Assert
    expect(stationary).toEqual([true, false]);
  });
});

// WHY: an atStop bus's expected departure counts its dwell from the first observation at that stop
// (add-jongro-bus-trajectory D4). Route 02 vehicle 100000058 (pos_100900008_1792314511, _531, _551, _612).
describe("BusRealtimeJongroService.refresh time at a stop", () => {
  const sighting58 = (sectOrd: number, stationId: string, isAtStop: boolean, observedAt: string, sectDist = 0) =>
    jongroSighting({ stationId, carNumber: "2008", vehicleId: "100000058", sectOrd, sectDist, fullSectDist: 0.135, isAtStop, observedAt });
  const atStopSinceAcross = async (ticks: JongroBusSighting[]) => {
    const since: Array<string | undefined> = [];
    for (const sighting of ticks) {
      client.sightings = [sighting];
      await service.refresh(route("02"));
      since.push((await service.listPositions("02"))![0]!.atStopSince);
    }
    return since;
  };

  it("keeps the first observation at a stop while the vehicle stays there, and none once it moves on", async () => {
    // Act
    const since = await atStopSinceAcross([
      sighting58(18, "100900189", false, "2026-10-18T18:08:20+09:00", 0.016),
      sighting58(19, "100900131", true, "2026-10-18T18:08:33+09:00"),
      sighting58(19, "100900131", true, "2026-10-18T18:08:49+09:00", 0.044),
      sighting58(19, "100900131", false, "2026-10-18T18:10:05+09:00", 0.044),
    ]);

    // Assert
    expect(since).toEqual([undefined, "2026-10-18T18:08:33+09:00", "2026-10-18T18:08:33+09:00", undefined]);
  });

  it("forgets it on a restart, so the next observation at the stop starts the count", async () => {
    // Arrange
    client.sightings = [sighting58(19, "100900131", true, "2026-10-18T18:08:33+09:00")];
    await service.refresh(route("02"));
    const registry = new BusRegistryService(asReal<BusRegistryRepository>(registryRepository), clock);
    service = new BusRealtimeJongroService(asReal<BusRealtimeJongroClient>(client), new BusCacheService(asReal<BusCacheRepository>(busCache)), registry, clock);

    // Act
    const since = await atStopSinceAcross([sighting58(19, "100900131", true, "2026-10-18T18:08:49+09:00", 0.044)]);

    // Assert
    expect(since).toEqual(["2026-10-18T18:08:49+09:00"]);
  });
});
