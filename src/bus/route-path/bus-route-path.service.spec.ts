/**
 * BusRoutePathService over an in-memory repository, a scripted TOPIS client
 * and a fixed clock (ADR 0012, D3): the read answers every stored route in the configured order, cached,
 * leaves a missing route out with an error line and a flag, serves the last
 * good lines through a failed read inside the stale window, and fails with a
 * 503 when a read fails with nothing cached, holding that failure for
 * ROUTE_PATHS_RETRY_MS and logging both at most once a minute, since the
 * no-store stop page reads the lines per request; the daily sync writes a route's
 * first line on the absolute checks alone, writes nothing for unchanged
 * content, holds a suspicious change with a warning, and writes a plausible
 * one, guarded by the version it read. No boot writes a line. A line stored
 * before stations carried their direction (production's, 2026-10-18) is
 * rewritten by the first sync after the deploy, which runs when the poller
 * starts, with the same points and stations gaining their directions.
 */
jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { FakeBusRoutePathClient } from "../../../__tests__/helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusRoutePathRepository } from "../../../__tests__/helpers/fakes/bus/bus-route-path.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { Position } from "../../shared/geojson.types";
import { JONGRO_ROUTES } from "../bus.constants";
import { capturedRoutePathOf, storedJongroRoutePathDocuments } from "../../../__tests__/helpers/bus/bus-route-path";
import { ROUTE_7800, fetchedRoutePath7800, routePathDoc7800 } from "../../../__tests__/helpers/bus/topis-7800";
import type { BusRoutePathClient } from "./bus-route-path.client";
import { ROUTE_PATHS_LOG_INTERVAL_MS, ROUTE_PATHS_RETRY_MS, ROUTE_PATHS_STALE_WINDOW_MS, ROUTE_PATHS_TTL_MS } from "./bus-route-path.constants";
import type { BusRoutePathRepository } from "./bus-route-path.repository";
import { toPathVersion } from "./bus-route-path.rules";
import { BusRoutePathService } from "./bus-route-path.service";
import type { FetchedRoutePath } from "./bus-route-path.types";

const jongroRoutes = JONGRO_ROUTES;

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

// WHY: the stop page is no-store and reads the lines per request, so an outage or a missing line must cost neither a
// MongoDB read nor an error line per page.
describe("BusRoutePathService.listRoutePaths read per request", () => {
  let nowMs: number;
  let perRequest: BusRoutePathService;

  beforeEach(() => {
    nowMs = NOW.getTime();
    perRequest = new BusRoutePathService(asReal<BusRoutePathRepository>(repository), asReal<BusRoutePathClient>(client), { now: () => new Date(nowMs) });
  });

  it("logs a missing route at most once a minute, counting the lines it held back", async () => {
    // Arrange
    storeLines();
    repository.routePaths.delete("jongro07");

    // Act
    await perRequest.listRoutePaths();
    await perRequest.listRoutePaths();
    const withinTheMinute = callsOf("error", "bus.jongro.path_missing").length;
    nowMs += ROUTE_PATHS_LOG_INTERVAL_MS;
    const { hasMissingRoutes } = await perRequest.listRoutePaths();

    // Assert
    expect(hasMissingRoutes).toBe(true);
    expect(withinTheMinute).toBe(1);
    expect(callsOf("error", "bus.jongro.path_missing")).toEqual([
      expect.objectContaining({ routeIds: ["jongro07"], suppressed: 0 }),
      expect.objectContaining({ routeIds: ["jongro07"], suppressed: 1 }),
    ]);
  });

  it("holds a failed read with nothing cached for ROUTE_PATHS_RETRY_MS, answering the 503 without a read, then reads again", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");
    await expect(perRequest.listRoutePaths()).rejects.toMatchObject({ code: "JONGRO_ROUTE_PATHS_UNAVAILABLE" });

    // Act
    nowMs += ROUTE_PATHS_RETRY_MS - 1;
    const held = perRequest.listRoutePaths();
    await expect(held).rejects.toMatchObject({ code: "JONGRO_ROUTE_PATHS_UNAVAILABLE", httpStatus: 503 });
    const readsWhileHeld = repository.listCount;
    repository.failWith = null;
    storeLines();
    nowMs += 1;
    const { routePaths } = await perRequest.listRoutePaths();

    // Assert
    expect(readsWhileHeld).toBe(1);
    expect(repository.listCount).toBe(2);
    expect(routePaths).toHaveLength(3);
    expect(callsOf("error", "bus.jongro.path_read_failed")).toHaveLength(1);
  });

  it("logs a read that keeps failing at most once a minute", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act
    for (const offsetMs of [0, ROUTE_PATHS_RETRY_MS, ROUTE_PATHS_LOG_INTERVAL_MS]) {
      nowMs = NOW.getTime() + offsetMs;
      await perRequest.listRoutePaths().catch(() => undefined);
    }

    // Assert
    expect(repository.listCount).toBe(3);
    expect(callsOf("error", "bus.jongro.path_read_failed")).toEqual([
      expect.objectContaining({ suppressed: 0 }),
      expect.objectContaining({ suppressed: 1 }),
    ]);
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

// WHY: a fresh database gets its lines from the daily sync, not a snapshot (ADR 0012, D3).
describe("BusRoutePathService.sync of a line stored before directions", () => {
  // EVIDENCE: production's Jongno 07 document on 2026-10-23: this content without directions, under eb9ffab88fbdad95.
  const storedBeforeDirections = () => {
    const doc = storedJongroRoutePathDocuments(NOW).find((each) => each._id === "jongro07")!;
    return { ...doc, stations: doc.stations.map(({ direction: _direction, ...rest }) => rest), pathVersion: "eb9ffab88fbdad95" };
  };

  it("rewrites it at the first sync with TOPIS's directions, though no point or station moved", async () => {
    // Arrange
    repository.routePaths.set("jongro07", storedBeforeDirections());
    client.answers.set("100900004", seedOf("jongro07"));

    // Act
    await service.sync(route07);

    // Assert
    const written = repository.routePaths.get("jongro07")!;
    expect(written.pathVersion).toBe(toPathVersion(seedOf("jongro07")));
    expect(written.stations.map((station) => station.direction)).toEqual([...Array(13).fill("이화사거리"), ...Array(9).fill("성균관대운동장")]);
    expect(written.path).toEqual(seedOf("jongro07").path);
    expect(callsOf("warn", "bus.jongro.path_synced")).toEqual([expect.objectContaining({ routeId: "jongro07", fromVersion: "eb9ffab88fbdad95" })]);
  });

  it("then writes nothing for the same answer", async () => {
    // Arrange
    repository.routePaths.set("jongro07", storedBeforeDirections());
    client.answers.set("100900004", seedOf("jongro07"));
    await service.sync(route07);
    const written = structuredClone(repository.routePaths.get("jongro07"));

    // Act
    await service.sync(route07);

    // Assert
    expect(repository.routePaths.get("jongro07")).toEqual(written);
    expect(callsOf("warn", "bus.jongro.path_synced")).toHaveLength(1);
  });
});

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

// WHY: 7800 is unlisted (docs/plans/7800-unified-arrivals.md, Q2): its line is synced like a Jongno one but drawn
// nowhere, so the map's read leaves it out and only a read by id answers it.
describe("BusRoutePathService over 7800's capture", () => {
  it("inserts 7800's line at its first sync: 80 stations, 사당역 for seq 1-39 and 호매실동차고지 after, the turnaround at seq 39", async () => {
    // Arrange
    client.answers.set("200000150", fetchedRoutePath7800());

    // Act
    await service.sync(ROUTE_7800);

    // Assert
    const stored = repository.routePaths.get("gyeonggi7800")!;
    expect([stored.busRouteId, stored.stations.length]).toEqual(["200000150", 80]);
    expect(stored.stations.filter((station) => station.direction === "사당역").map((station) => station.sequence)).toEqual(Array.from({ length: 39 }, (_, index) => index + 1));
    expect(stored.stations.filter((station) => station.isTurnaround).map((station) => station.topisId)).toEqual(["121001315"]);
    expect(callsOf("warn", "bus.jongro.path_synced")).toHaveLength(1);
  });

  it("leaves 7800 out of the lines the map draws, and logs no missing line, with or without it stored", async () => {
    // Arrange
    storeLines();
    const withoutLine = await service.listRoutePaths();
    repository.routePaths.set("gyeonggi7800", routePathDoc7800(NOW));
    service = new BusRoutePathService(asReal<BusRoutePathRepository>(repository), asReal<BusRoutePathClient>(client), clock);

    // Act
    const withLine = await service.listRoutePaths();

    // Assert
    expect([withoutLine, withLine].map(({ routePaths, hasMissingRoutes }) => [routePaths.map((routePath) => routePath.routeId), hasMissingRoutes])).toEqual([
      [["jongro02", "jongro07", "jongro08"], false],
      [["jongro02", "jongro07", "jongro08"], false],
    ]);
    expect(callsOf("error", "bus.jongro.path_missing")).toEqual([]);
  });

  it("answers 7800's stored line by id, and null before its first sync", async () => {
    // Arrange
    storeLines();
    const beforeSync = await service.findRoutePath("gyeonggi7800");
    repository.routePaths.set("gyeonggi7800", routePathDoc7800(NOW));
    service = new BusRoutePathService(asReal<BusRoutePathRepository>(repository), asReal<BusRoutePathClient>(client), clock);

    // Act
    const afterSync = await service.findRoutePath("gyeonggi7800");

    // Assert
    expect(beforeSync).toBeNull();
    expect([afterSync?.routeId, afterSync?.code, afterSync?.stations.length]).toEqual(["gyeonggi7800", "7800", 80]);
  });
});

