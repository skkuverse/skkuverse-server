/**
 * BusStopIndexService, the door to the stop index: built
 * from the current `bus-stops` snapshot and every stored Jongno route over in-memory stores, kept while the
 * revision and every stations version stay, and rebuilt when one changes. An alias no stored station has is warned
 * once per revision. `findStop` resolves a stop id, an aliased pole's to its local stop, with the stop's own
 * coordinates or its pole's on the stored route line; an unread registry route is left out, and a pole only it
 * could name, or a local stop aliasing a pole that no readable route serves, is that route's 503, not a 404. With the stops never read, the index is the stops' 503.
 *
 * The registry's cached loader reads `Date.now()`, so its TTL is crossed with Jest's fake system time.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import { storedBusRegistryRepository, storedBusRegistryService } from "../../../__tests__/helpers/bus/bus-registry";
import { busStopsFixture, storedBusStopsRepository, storedBusStopsService } from "../../../__tests__/helpers/bus/bus-stops";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import logger from "../../infra/logger";
import type { BusRoutePathService } from "../route-path/bus-route-path.service";
import { BusStopIndexService } from "./bus-stop-index.service";

const NOW = new Date("2026-10-21T13:52:00.000Z");
// WHY: past the registry's 30 s TTL (REGISTRY_TTL_MS), which a sibling's spec may not import.
const PAST_REGISTRY_TTL_MS = 31_000;
type FixtureStop = { id: string; arsIds?: string[] };

function setup({ aliases = {} as Record<string, string[]> } = {}) {
  const data = busStopsFixture() as unknown as { stops: FixtureStop[] };
  for (const [stopId, arsIds] of Object.entries(aliases)) data.stops.find((stop) => stop.id === stopId)!.arsIds = arsIds;
  const stopsRepository = storedBusStopsRepository(data);
  const registryRepository = storedBusRegistryRepository();
  const routePaths = new FakeBusRoutePathService();
  routePaths.routePaths = {
    routePaths: [
      { routeId: "jongro02", code: "02", ...capturedRoutePathOf("jongro02") },
      { routeId: "jongro07", code: "07", ...capturedRoutePathOf("jongro07") },
      { routeId: "jongro08", code: "08", ...capturedRoutePathOf("jongro08") },
    ],
    hasMissingRoutes: false,
  };
  const service = new BusStopIndexService(
    storedBusStopsService(stopsRepository, { now: () => new Date() }),
    storedBusRegistryService(registryRepository),
    asReal<BusRoutePathService>(routePaths),
    { now: () => new Date() },
  );
  return { service, data, stopsRepository, registryRepository, routePaths };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusStopIndexService.findStop and the index it reads", () => {
  it("builds the index once while the revision and the stations versions stay", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const first = await service.findStop("seoul-01592");
    const second = await service.findStop("seoul-01592");

    // Assert
    expect(second!.routes).toBe(first!.routes);
    expect(first!.routes.map((route) => route.groupId)).toEqual(["jongro07", "jongro08"]);
  });

  it("rebuilds the index once a route's stations version changes", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    const before = await service.findStop("seoul-01999");
    const jongro08 = registryRepository.routes.get("jongro08")!;
    jongro08.stations = [...jongro08.stations, { topisId: "NEW", arsId: "01999", stationName: "새 정류장", sequence: jongro08.stations.length + 1 }];
    jongro08.stationsVersion = "added-01999";
    jest.setSystemTime(NOW.getTime() + PAST_REGISTRY_TTL_MS);

    // Act
    const after = await service.findStop("seoul-01999");

    // Assert
    expect(before).toBeNull();
    expect(after?.routes).toEqual([{ kind: "jongro", groupId: "jongro08", stationIndex: 31, towards: null, stationsVersion: "added-01999" }]);
  });

  it("warns of an alias no stored station has once per revision", async () => {
    // Arrange
    const { service, stopsRepository, data } = setup({ aliases: { "hssc-600th": ["09999"] } });

    // Act
    await service.findStop("hssc-600th");
    await service.findStop("hssc-600th");
    stopsRepository.storeStops(data);
    jest.setSystemTime(NOW.getTime() + 61_000);
    await service.findStop("hssc-600th");

    // Assert
    const warnings = jest.mocked(logger.warn).mock.calls.filter((call) => (call[0] as { event?: string }).event === "bus.stop_index.alias_unmatched");
    expect(warnings).toHaveLength(2);
    expect(logText(warnings[0])).toContain("09999");
    expect(warnings.map((call) => (call[0] as { revision: number }).revision)).toEqual([1, 2]);
  });

  it("leaves out a route whose registry is missing", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.routes.delete("jongro07");

    // Act
    const stop = await service.findStop("seoul-01592");

    // Assert
    expect(stop?.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
  });

  it("answers the stops' 503 when they were never read", async () => {
    // Arrange
    const { service, stopsRepository } = setup();
    stopsRepository.stored = null;

    // Act & Assert
    await expect(service.findStop("hssc-bus-lot")).rejects.toMatchObject({ code: "BUS_STOPS_UNAVAILABLE", httpStatus: 503 });
  });
});

describe("BusStopIndexService.findStop", () => {
  it("finds a TOPIS pole with its route line's coordinates", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const stop = await service.findStop("seoul-01592");

    // Assert
    expect(stop).toMatchObject({ id: "seoul-01592", localStop: null, coords: { lat: 37.5834729904, lng: 127.0017632862 } });
    expect(stop?.snapshot.revision).toBe(1);
  });

  it("finds a local stop with its own coordinates", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const stop = await service.findStop("jeongja-exit3");

    // Assert
    expect(stop).toMatchObject({ id: "jeongja-exit3", localStop: { id: "jeongja-exit3" }, coords: { lat: 37.365499, lng: 127.107906 } });
  });

  it("finds an HSSC stop with no coordinates", async () => {
    // Arrange
    const { service } = setup();

    // Act
    const stop = await service.findStop("hssc-hyehwa-exit1");

    // Assert
    expect(stop).toMatchObject({ id: "hssc-hyehwa-exit1", coords: null });
  });

  it("resolves an aliased pole to its local stop", async () => {
    // Arrange
    const { service } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });

    // Act
    const byPole = await service.findStop("seoul-01618");
    const bySlug = await service.findStop("hssc-bus-lot");

    // Assert
    expect(byPole?.id).toBe("hssc-bus-lot");
    expect(byPole?.routes.map((route) => route.groupId)).toEqual(["campus", "campus", "jongro07"]);
    expect(bySlug?.routes).toEqual(byPole?.routes);
  });

  it("draws an aliased local stop with no coordinates at its pole", async () => {
    // Arrange
    const { service } = setup({ aliases: { "hssc-student-center": ["01618"] } });

    // Act
    const stop = await service.findStop("hssc-student-center");

    // Assert
    expect(stop?.coords).toEqual({ lat: 37.5874203934, lng: 126.9936746328 });
  });

  it("finds a pole with no coordinates when the route lines cannot be read", async () => {
    // Arrange
    const { service, routePaths } = setup();
    routePaths.failWith = new Error("unreadable");

    // Act
    const stop = await service.findStop("seoul-01592");

    // Assert
    expect(stop).toMatchObject({ id: "seoul-01592", coords: null });
  });

  it.each(["seoul-99999", "hssc-nowhere", "seoul-0159"])("answers null for %s, which no served route stops at", async (stopId) => {
    // Arrange
    const { service } = setup();

    // Act & Assert
    expect(await service.findStop(stopId)).toBeNull();
  });

  it("answers the missing route's 503 for a pole only it could name, and finds the others", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.routes.delete("jongro07");

    // Act & Assert
    await expect(service.findStop("seoul-01616")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    expect((await service.findStop("seoul-01592"))?.routes.map((route) => route.groupId)).toEqual(["jongro08"]);
    expect((await service.findStop("hssc-bus-lot"))?.id).toBe("hssc-bus-lot");
  });
});

describe("BusStopIndexService.servedRecordOf", () => {
  it("serves a local stop as its config record in the request language, without its map", async () => {
    // Arrange
    const { service } = setup();
    const stop = (await service.findStop("jeongja-exit3"))!;

    // Act
    const record = service.servedRecordOf(stop, "en");

    // Assert
    expect(record).toMatchObject({ id: "jeongja-exit3", name: "Jeongja Stn. Exit 3", subwayStation: { id: "jeongja" } });
    expect(record).not.toHaveProperty("map");
  });

  it("serves none for a TOPIS pole", async () => {
    // Arrange
    const { service } = setup();
    const stop = (await service.findStop("seoul-01592"))!;

    // Act & Assert
    expect(service.servedRecordOf(stop, "ko")).toBeNull();
  });
});

// WHY: a registry outage must not cost a MongoDB read and an error line per stop page.
describe("BusStopIndexService.findStop while the registry cannot be read", () => {
  const events = (level: "warn" | "error", event: string) => jest.mocked(logger[level]).mock.calls.filter((call) => (call[0] as { event?: string }).event === event);

  it("answers a pole the 503 JONGRO_REGISTRY_UNAVAILABLE on a database error, logs the unread routes, and finds the local stops", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.failWith = new Error("connection timed out");

    // Act & Assert
    await expect(service.findStop("seoul-01592")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    expect((await service.findStop("hssc-bus-lot"))?.id).toBe("hssc-bus-lot");
    expect(events("error", "bus.stop_index.registry_unread")).toHaveLength(1);
    expect(logText(events("error", "bus.stop_index.registry_unread")[0])).toContain("jongro07");
  });

  it("reads an unread route again only once REGISTRY_RETRY_MS has passed", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.routes.delete("jongro07");

    // Act
    await service.findStop("hssc-bus-lot");
    await service.findStop("nsc-n-center");
    const beforeRetry = events("error", "bus.jongro.registry_missing").length;
    jest.setSystemTime(NOW.getTime() + PAST_REGISTRY_TTL_MS);
    await service.findStop("hssc-bus-lot");

    // Assert
    expect(beforeRetry).toBe(1);
    expect(events("error", "bus.jongro.registry_missing")).toHaveLength(2);
  });

  it("logs a route that stays unread on the retries too, at most once a minute (review F1)", async () => {
    // Arrange
    const { service, registryRepository } = setup();
    registryRepository.failWith = new Error("connection timed out");
    await service.findStop("hssc-bus-lot");

    // Act
    jest.setSystemTime(NOW.getTime() + PAST_REGISTRY_TTL_MS);
    await service.findStop("hssc-bus-lot");
    const withinTheMinute = events("error", "bus.stop_index.registry_unread").length;
    jest.setSystemTime(NOW.getTime() + 2 * PAST_REGISTRY_TTL_MS);
    await service.findStop("hssc-bus-lot");

    // Assert
    expect(withinTheMinute).toBe(1);
    expect(events("error", "bus.stop_index.registry_unread")).toHaveLength(2);
    expect(events("error", "bus.stop_index.registry_unread")[1]![0]).toMatchObject({ routeIds: ["jongro02", "jongro07", "jongro08"], suppressed: 1 });
  });

  it("serves an aliased pole's local stop while the route that lists the pole cannot be read", async () => {
    // Arrange
    const { service, registryRepository } = setup({ aliases: { "hssc-bus-lot": ["01618"] } });
    registryRepository.routes.delete("jongro07");

    // Act
    const stop = await service.findStop("seoul-01618");

    // Assert
    expect(stop?.id).toBe("hssc-bus-lot");
    expect(stop?.routes.map((route) => route.groupId)).toEqual(["campus", "campus"]);
  });

  // WHY: 404 tells a client the stop is gone; a local stop only an unread route serves is that route's 503, as its pole is.
  it("answers the 503 for a local stop only its aliased pole's unread route serves, by its id and by its pole's", async () => {
    // Arrange
    const { service, stopsRepository, registryRepository, data } = setup();
    data.stops.push({ id: "hssc-jongro-only", name: { ko: "종로 전용", en: "Jongno only", zh: "钟路专用" }, arsIds: ["01616"] } as FixtureStop);
    stopsRepository.storeStops(data);
    registryRepository.routes.delete("jongro07");

    // Act & Assert
    await expect(service.findStop("hssc-jongro-only")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    await expect(service.findStop("seoul-01616")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
  });

  it("finds that local stop once its route can be read, and answers null for a local stop that aliases nothing", async () => {
    // Arrange
    const { service, stopsRepository, data } = setup();
    data.stops.push({ id: "hssc-jongro-only", name: { ko: "종로 전용", en: "Jongno only", zh: "钟路专용" }, arsIds: ["01616"] } as FixtureStop);
    stopsRepository.storeStops(data);

    // Act
    const stop = await service.findStop("hssc-jongro-only");

    // Assert
    expect(stop?.routes.map((route) => route.groupId)).toEqual(["jongro07"]);
    expect(await service.findStop("hssc-nowhere")).toBeNull();
  });
});
