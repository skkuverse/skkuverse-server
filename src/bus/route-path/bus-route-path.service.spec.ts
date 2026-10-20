/**
 * BusRoutePathService over an in-memory repository, a scripted TOPIS client
 * and a fixed clock (add-jongro-route-lines D3–D5, isolate-api-from-pollers
 * D3): the read answers every stored route in the configured order, cached,
 * leaves a missing route out with an error line and a flag, serves the last
 * good lines through a failed read inside the stale window, and fails with a
 * 503 when a read fails with nothing cached; the daily sync writes a route's
 * first line on the absolute checks alone, writes nothing for unchanged
 * content, holds a suspicious change with a warning, and writes a plausible
 * one, guarded by the version it read. No boot writes a line.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBusRoutePathClient } from "../../../__tests__/helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusRoutePathRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-path.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { Position } from "../../shared/geojson.types";
import { JONGRO_ROUTES } from "../bus.constants";
import { toJongroRoute } from "../bus.mapper";
import { capturedRoutePathOf, storedJongroRoutePathDocuments } from "../../../__tests__/helpers/bus/bus-route-path";
import type { BusRoutePathClient } from "./bus-route-path.client";
import { ROUTE_PATHS_STALE_WINDOW_MS, ROUTE_PATHS_TTL_MS } from "./bus-route-path.constants";
import type { BusRoutePathRepository } from "./bus-route-path.repository";
import { toPathVersion } from "./bus-route-path.rules";
import { BusRoutePathService } from "./bus-route-path.service";
import type { FetchedRoutePath } from "./bus-route-path.types";

const jongroRoutes = JONGRO_ROUTES.map(toJongroRoute);

const NOW = new Date("2026-10-18T03:00:00Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) => mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

const route07 = jongroRoutes.find((route) => route.id === "jongro07")!;
const seedOf = (routeId: string): FetchedRoutePath => capturedRoutePathOf(routeId);
const storeLines = () => {
  for (const doc of storedJongroRoutePathDocuments(NOW)) repository.routePaths.set(doc._id, doc);
};
const shifted = (fetched: FetchedRoutePath, keep = fetched.path.length): FetchedRoutePath => ({
  ...fetched,
  path: fetched.path.slice(0, keep).map(([lng, lat]): Position => [lng + 0.00001, lat]),
});

let repository: FakeBusRoutePathRepository;
let client: FakeBusRoutePathClient;
let service: BusRoutePathService;

beforeEach(() => {
  jest.clearAllMocks();
  repository = new FakeBusRoutePathRepository();
  client = new FakeBusRoutePathClient();
  service = new BusRoutePathService(asReal<BusRoutePathRepository>(repository), asReal<BusRoutePathClient>(client), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("BusRoutePathService.listRoutePaths", () => {
  it("answers every stored route in the configured order, with its code, from one cached read", async () => {
    // Arrange
    storeLines();
    const edited = shifted(seedOf("jongro07"));
    repository.routePaths.get("jongro07")!.path = edited.path;

    // Act
    const first = await service.listRoutePaths();
    const second = await service.listRoutePaths();

    // Assert
    expect(first.hasMissingRoutes).toBe(false);
    expect(first.routePaths.map((r) => [r.routeId, r.code, r.path.length, r.stations.length])).toEqual([
      ["jongro02", "02", 252, 27],
      ["jongro07", "07", 241, 22],
      ["jongro08", "08", 488, 31],
    ]);
    expect(first.routePaths[1]!.path).toEqual(edited.path);
    expect(second).toEqual(first);
    expect(repository.listCount).toBe(1);
  });

  it("leaves a missing route out, flags the answer and logs the route at error", async () => {
    // Arrange
    storeLines();
    repository.routePaths.delete("jongro07");

    // Act
    const { routePaths, hasMissingRoutes } = await service.listRoutePaths();

    // Assert
    expect(hasMissingRoutes).toBe(true);
    expect(routePaths.map((r) => r.routeId)).toEqual(["jongro02", "jongro08"]);
    expect(callsOf("error", "bus.jongro.path_missing").map((fields) => fields.routeIds)).toEqual([["jongro07"]]);
  });

  it("answers no line and flags it on an empty store", async () => {
    // Act
    const { routePaths, hasMissingRoutes } = await service.listRoutePaths();

    // Assert
    expect(routePaths).toEqual([]);
    expect(hasMissingRoutes).toBe(true);
  });

  it("fails with a 503 when the read fails with nothing cached", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act & Assert
    await expect(service.listRoutePaths()).rejects.toMatchObject({ code: "JONGRO_ROUTE_PATHS_UNAVAILABLE", httpStatus: 503 });
  });

  it("serves a line another process wrote once the TTL has passed, not the expired one (ADR 0012, D6)", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    storeLines();
    await service.listRoutePaths();
    repository.routePaths.delete("jongro07");

    // Act
    jest.setSystemTime(NOW.getTime() + ROUTE_PATHS_TTL_MS);
    const { routePaths, hasMissingRoutes } = await service.listRoutePaths();

    // Assert
    expect(routePaths.map((line) => line.routeId)).toEqual(["jongro02", "jongro08"]);
    expect(hasMissingRoutes).toBe(true);
  });

  it("serves the earlier lines through a failed read inside the stale window", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    storeLines();
    const earlier = await service.listRoutePaths();
    repository.failWith = new Error("atlas down");

    // Act
    jest.setSystemTime(NOW.getTime() + ROUTE_PATHS_TTL_MS + 1);
    const atTtl = await service.listRoutePaths();
    jest.setSystemTime(NOW.getTime() + ROUTE_PATHS_TTL_MS + ROUTE_PATHS_STALE_WINDOW_MS - 1);
    const atWindowEnd = await service.listRoutePaths();

    // Assert
    expect(atTtl).toEqual(earlier);
    expect(atWindowEnd).toEqual(earlier);
  });

  it("keeps the stale window at a day at least, so an Atlas outage never blanks the overlay sooner", () => {
    // Act & Assert
    expect(ROUTE_PATHS_STALE_WINDOW_MS).toBeGreaterThanOrEqual(24 * 60 * 60_000);
  });
});

describe("BusRoutePathService.sync", () => {
  beforeEach(() => {
    storeLines();
  });

  it("asks TOPIS by the route's busRouteId and writes nothing for unchanged content", async () => {
    // Arrange
    const before = structuredClone(repository.routePaths.get("jongro07"));
    client.answers.set("100900004", seedOf("jongro07"));

    // Act
    await service.sync(route07);

    // Assert
    expect(client.requestedIds).toEqual(["100900004"]);
    expect(repository.routePaths.get("jongro07")).toEqual(before);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it("writes a plausible change, logs it, and serves it on the next read", async () => {
    // Arrange
    await service.listRoutePaths();
    const rerouted = shifted(seedOf("jongro07"));
    client.answers.set("100900004", rerouted);

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toMatchObject({ path: rerouted.path, pathVersion: toPathVersion(rerouted), syncedAt: NOW });
    expect(callsOf("warn", "bus.jongro.path_synced")).toEqual([
      expect.objectContaining({ routeId: "jongro07", fromVersion: toPathVersion(seedOf("jongro07")), toVersion: toPathVersion(rerouted), pointCount: 241, stationCount: 22 }),
    ]);
    expect((await service.listRoutePaths()).routePaths[1]!.path).toEqual(rerouted.path);
  });

  it("holds a line with under 70% of the stored points, writes nothing and warns once per change", async () => {
    // Arrange
    const before = structuredClone(repository.routePaths.get("jongro07"));
    client.answers.set("100900004", shifted(seedOf("jongro07"), 120));

    // Act
    await service.sync(route07);
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toEqual(before);
    expect(callsOf("warn", "bus.jongro.path_change_held")).toEqual([
      expect.objectContaining({ routeId: "jongro07", reason: "pointCountChanged", fromPointCount: 241, toPointCount: 120, fromStationCount: 22, toStationCount: 22 }),
    ]);
  });

  it("holds an answer with no station", async () => {
    // Arrange
    client.answers.set("100900004", { ...shifted(seedOf("jongro07")), stations: [] });

    // Act
    await service.sync(route07);

    // Assert
    expect(callsOf("warn", "bus.jongro.path_change_held").map((fields) => fields.reason)).toEqual(["noStations"]);
    expect(repository.routePaths.get("jongro07")!.stations).toHaveLength(22);
  });

  it("writes a missing route's first line of 10 points, with no stored line to compare it with", async () => {
    // Arrange
    repository.routePaths.delete("jongro07");
    const short = shifted(seedOf("jongro07"), 10);
    client.answers.set("100900004", short);

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toMatchObject({ busRouteId: "100900004", pathVersion: toPathVersion(short), syncedAt: NOW });
    expect(callsOf("warn", "bus.jongro.path_synced")).toEqual([expect.objectContaining({ routeId: "jongro07", fromVersion: null, pointCount: 10 })]);
  });

  it("writes nothing when another writer changed the version first, and says so", async () => {
    // Arrange
    client.answers.set("100900004", shifted(seedOf("jongro07")));
    const update = repository.updateRoutePath.bind(repository);
    repository.updateRoutePath = async (_fromVersion, routePath) => update("someone-else", routePath);

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")!.pathVersion).toBe(toPathVersion(seedOf("jongro07")));
    expect(callsOf("warn", "bus.jongro.path_sync_conflict")).toHaveLength(1);
  });

  it("rejects with TOPIS's failure and writes nothing", async () => {
    // Arrange
    const before = structuredClone(repository.routePaths.get("jongro07"));
    client.failWith = new Error("TOPIS error code (getRoutePath 100900004)");

    // Act & Assert
    await expect(service.sync(route07)).rejects.toThrow("TOPIS error code");
    expect(repository.routePaths.get("jongro07")).toEqual(before);
  });
});

// WHY: a fresh database gets its lines from the daily sync, not a snapshot (isolate-api-from-pollers D3).
describe("BusRoutePathService.sync on an empty store", () => {
  it("writes the first line, and the read then serves it", async () => {
    // Arrange
    client.answers.set("100900004", seedOf("jongro07"));
    await service.listRoutePaths();

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toEqual({ _id: "jongro07", busRouteId: "100900004", ...seedOf("jongro07"), pathVersion: toPathVersion(seedOf("jongro07")), syncedAt: NOW });
    expect((await service.listRoutePaths()).routePaths.map((r) => [r.routeId, r.path.length])).toEqual([["jongro07", 241]]);
  });

  it("holds a first line of 9 points, writes nothing and warns with the route", async () => {
    // Arrange
    client.answers.set("100900004", shifted(seedOf("jongro07"), 9));

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.has("jongro07")).toBe(false);
    expect(callsOf("warn", "bus.jongro.path_change_held")).toEqual([
      expect.objectContaining({ routeId: "jongro07", reason: "tooFewPoints", fromVersion: null, fromPointCount: null, toPointCount: 9 }),
    ]);
  });
});
