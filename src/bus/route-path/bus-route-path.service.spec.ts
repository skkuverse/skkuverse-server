/**
 * BusRoutePathService over an in-memory repository, a scripted TOPIS client
 * and a fixed clock (add-jongro-route-lines D3–D5): every boot seeds a
 * missing route from the committed snapshot and never overwrites a stored
 * one; the read answers every configured route in order, cached, with a
 * missing route or a failed read drawn from the snapshot and flagged; and the
 * daily sync writes nothing for unchanged content, holds a suspicious change
 * with a warning, and writes a plausible one, guarded by the version it read.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBusRoutePathClient } from "../../../__tests__/helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusRoutePathRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-path.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { Position } from "../../shared/geojson.types";
import { jongroRoutes } from "../bus.config";
import type { BusRoutePathClient } from "./bus-route-path.client";
import { routePathsSeed } from "./bus-route-path.config";
import { toSeedRoutePath } from "./bus-route-path.mapper";
import type { BusRoutePathRepository } from "./bus-route-path.repository";
import { toPathVersion } from "./bus-route-path.rules";
import { BusRoutePathService } from "./bus-route-path.service";
import type { FetchedRoutePath } from "./bus-route-path.types";

const NOW = new Date("2026-10-18T03:00:00Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "warn" | "error", event: string) => mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event).map(([fields]) => fields);

const route07 = jongroRoutes.find((route) => route.id === "jongro07")!;
const seedOf = (routeId: string): FetchedRoutePath => toSeedRoutePath(routePathsSeed.find((seed) => seed.id === routeId)!);
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

describe("BusRoutePathService.onModuleInit", () => {
  it("seeds every configured route from the snapshot and logs one seed line each", async () => {
    // Act
    await service.onModuleInit();

    // Assert
    expect([...repository.routePaths.keys()]).toEqual(["jongro02", "jongro07", "jongro08"]);
    expect(repository.routePaths.get("jongro07")).toEqual({
      _id: "jongro07",
      busRouteId: "100900004",
      ...seedOf("jongro07"),
      pathVersion: toPathVersion(seedOf("jongro07")),
      syncedAt: NOW,
    });
    expect(callsOf("warn", "bus.jongro.path_seeded").map((fields) => fields.routeId)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });

  it("keeps a stored line and logs no seed for it", async () => {
    // Arrange
    await service.onModuleInit();
    repository.routePaths.get("jongro07")!.pathVersion = "operator-edit";
    jest.clearAllMocks();

    // Act
    await service.onModuleInit();

    // Assert
    expect(repository.routePaths.get("jongro07")!.pathVersion).toBe("operator-edit");
    expect(callsOf("warn", "bus.jongro.path_seeded")).toEqual([]);
  });

  it("logs a failed seed at error and lets the boot go on", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act
    await service.onModuleInit();

    // Assert
    expect(callsOf("error", "bus.jongro.path_seed_failed").map((fields) => fields.routeId)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });
});

describe("BusRoutePathService.listRoutePaths", () => {
  it("answers every stored route in the configured order, with its code, from one cached read", async () => {
    // Arrange
    await service.onModuleInit();
    const edited = shifted(seedOf("jongro07"));
    repository.routePaths.get("jongro07")!.path = edited.path;

    // Act
    const first = await service.listRoutePaths();
    const second = await service.listRoutePaths();

    // Assert
    expect(first.isSeedFallback).toBe(false);
    expect(first.routePaths.map((r) => [r.routeId, r.code, r.path.length, r.stations.length])).toEqual([
      ["jongro02", "02", 252, 27],
      ["jongro07", "07", 241, 22],
      ["jongro08", "08", 488, 31],
    ]);
    expect(first.routePaths[1]!.path).toEqual(edited.path);
    expect(second).toEqual(first);
    expect(repository.listCount).toBe(1);
  });

  it("draws a missing route from the snapshot, flags the answer and warns with the route", async () => {
    // Arrange
    await service.onModuleInit();
    repository.routePaths.delete("jongro07");

    // Act
    const { routePaths, isSeedFallback } = await service.listRoutePaths();

    // Assert
    expect(isSeedFallback).toBe(true);
    expect(routePaths[1]).toEqual({ routeId: "jongro07", code: "07", ...seedOf("jongro07") });
    expect(callsOf("warn", "bus.jongro.path_missing").map((fields) => fields.routeIds)).toEqual([["jongro07"]]);
  });

  it("draws every route from the snapshot when the read fails with nothing cached", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act
    const { routePaths, isSeedFallback } = await service.listRoutePaths();

    // Assert
    expect(isSeedFallback).toBe(true);
    expect(routePaths.map((r) => r.path)).toEqual(["jongro02", "jongro07", "jongro08"].map((id) => seedOf(id).path));
    expect(callsOf("warn", "bus.jongro.path_read_failed")).toHaveLength(1);
  });
});

describe("BusRoutePathService.sync", () => {
  beforeEach(async () => {
    await service.onModuleInit();
    jest.clearAllMocks();
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

  it("writes a missing route from TOPIS, judged against the snapshot", async () => {
    // Arrange
    repository.routePaths.delete("jongro07");
    client.answers.set("100900004", seedOf("jongro07"));

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toMatchObject({ busRouteId: "100900004", pathVersion: toPathVersion(seedOf("jongro07")) });
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
