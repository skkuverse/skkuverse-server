/**
 * BusRegistryService over an in-memory registry repository and a fixed clock
 * (ADR 0012, D3; ADR 0014, D4): a stored
 * route derives the stations, mapping and URLs production served from
 * the route file they replaced; a missing document fails a read with a 503 and an error
 * line, while the poller's read answers null; reads are cached for 30 s; the
 * poller's observations follow TOPIS's stop list: applied at the third
 * identical tick, held over 30%, an empty list ignored, every applied change
 * logged with its diff; and a route with no document is inserted from the
 * third identical observation with an agreed turnaround stop, never over a
 * document another writer stored first.
 */
jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusRegistryRepository } from "../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { JONGRO_ROUTES } from "../bus.constants";
import { capturedStationsOf, storedJongroRouteDocuments } from "../../../__tests__/helpers/bus/bus-registry";
import { ROUTE_7800, TURNAROUND_7800, arrivalDocs7800, registryDoc7800, sightings7800 } from "../../../__tests__/helpers/bus/topis-7800";
import type { BusRegistryRepository } from "./bus-registry.repository";
import { toStationsVersion } from "./bus-registry.rules";
import { BusRegistryBootstrappingError } from "./bus-registry.error";
import { BusRegistryService } from "./bus-registry.service";
import type { ObservedStation } from "./bus-registry.types";

const jongroRoutes = JONGRO_ROUTES;

const NOW = new Date("2026-10-17T12:00:00Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "info" | "warn" | "error", event: string) => mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event);

let repository: FakeBusRegistryRepository;
let service: BusRegistryService;

const storeRoutes = () => {
  for (const doc of storedJongroRouteDocuments(NOW)) repository.routes.set(doc._id, doc);
};
const rowsOf = (stations: readonly ObservedStation[]) =>
  stations.map((s, index) => ({ stationId: s.topisId, sequence: String(index + 1), stationName: s.stationName, stationNumber: s.arsId }));
const ignoreBootstrapping = (err: unknown): void => {
  if (!(err instanceof BusRegistryBootstrappingError)) throw err;
};
const storedStationsOf = (routeId: string) => repository.routes.get(routeId)!.stations.map(({ topisId, arsId, stationName }) => ({ topisId, arsId, stationName }));

async function observeTimes(routeId: string, stations: readonly ObservedStation[], times: number, turnaroundIds: string[] = []): Promise<void> {
  for (let i = 0; i < times; i++) await service.observe(await service.routeOf(routeId), rowsOf(stations), turnaroundIds);
}

beforeEach(async () => {
  jest.clearAllMocks();
  repository = new FakeBusRegistryRepository();
  service = new BusRegistryService(asReal<BusRegistryRepository>(repository), clock);
});

afterEach(() => {
  jest.useRealTimers();
});

// The pins of the committed route file before its stations moved here, read now from the stored registry.
describe("BusRegistryService.routeOf over the routes stored on 2026-10-17", () => {
  beforeEach(() => {
    storeRoutes();
  });

  it("builds 종로08 from TOPIS route 100900005: 31 stops, 회차 at 재향군인회관", async () => {
    // Act
    const r08 = await service.routeOf("jongro08");

    // Assert
    expect(r08.busRouteId).toBe("100900005");
    expect(r08.stations).toHaveLength(31);
    expect(r08.stations[0]!.isFirstStation).toBe(true);
    expect(r08.stations[0]!.stationName).toBe("명륜3가종점");
    expect(r08.stations[30]!.isLastStation).toBe(true);
    expect(r08.stations[30]!.stationName).toBe("샘미용실.종로구청소년상담복지센터");
    expect(r08.stations.filter((s) => s.isRotationStation).map((s) => s.stationName)).toEqual(["서울특별시재향군인회관"]);
    expect(r08.stations[15]!.isRotationStation).toBe(true);
    expect(r08.stations[16]!.stationName).toBe("종로5가역.광장시장");
    expect(r08).not.toHaveProperty("transferLinesByArsId");
  });

  it("preserves station counts (02=27, 07=22), the loop close and the turnaround stops in TOPIS order", async () => {
    // Act
    const [r02, r07] = [await service.routeOf("jongro02"), await service.routeOf("jongro07")];

    // Assert
    expect(r02.stations).toHaveLength(27);
    expect(r07.stations).toHaveLength(22);
    expect(r02.stations[0]!.stationName).toBe("성균관대학교");
    expect(r02.stations[25]!.stationName).toBe("성대후문.와룡공원");
    expect(r02.stations[26]!.isLastStation).toBe(true);
    expect(r02.stations[26]!.stationName).toBe("성균관대학교");
    expect(r07.stations[0]!.stationName).toBe("성균관대운동장");
    expect(r07.stations[21]!.stationName).toBe("600주년기념관");
    expect(r02.stations.filter((s) => s.isRotationStation).map((s) => s.sequence)).toEqual(["13"]);
    expect(r07.stations.filter((s) => s.isRotationStation).map((s) => s.stationName)).toEqual(["방송통신대앞"]);
  });

  it("derives sequence (1-based string), stationNumber and the TOPIS id mapping", async () => {
    // Act
    const [r02, r07] = [await service.routeOf("jongro02"), await service.routeOf("jongro07")];

    // Assert
    expect(r02.stations[26]!.sequence).toBe("27");
    expect(r02.stations[26]!.stationNumber).toBe("01881");
    expect(r02.mapping["100900086"]).toEqual({ sequence: 10, stationName: "헌법재판소.안국역" });
    expect(r02.mapping["100900204"]).toEqual({ sequence: 1, stationName: "성균관대학교" });
    expect(r02.topisIds).toHaveLength(27);
    expect(r07.mapping["100900197"]).toEqual({ sequence: 6, stationName: "명륜새마을금고" });
    expect(r07.mapping["100000423"]).toEqual({ sequence: 21, stationName: "비천당" });
    expect(r07.mapping["100000424"]).toEqual({ sequence: 3, stationName: "비천당" });
  });

  it("lists every configured route", async () => {
    // Act & Assert
    expect((await service.listRoutes()).map((route) => route.id)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });
});

describe("BusRegistryService.routeOf for a route that stays missing", () => {
  it("logs it at most once per REGISTRY_TTL_MS, counting the lines it left out, while each read still answers the 503", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    // Built under the fake clock, which its log throttle reads.
    service = new BusRegistryService(asReal<BusRegistryRepository>(repository), clock);
    const reads = () => service.routeOf("gyeonggi7800").catch((err: unknown) => err);

    // Act
    const answers = [await reads(), await reads(), await reads()];
    jest.setSystemTime(NOW.getTime() + 30_001);
    await reads();

    // Assert
    expect(answers.map((err) => (err as { code?: string }).code)).toEqual(["JONGRO_REGISTRY_UNAVAILABLE", "JONGRO_REGISTRY_UNAVAILABLE", "JONGRO_REGISTRY_UNAVAILABLE"]);
    expect(callsOf("error", "bus.jongro.registry_missing").map(([fields]) => [fields.routeId, fields.suppressed])).toEqual([
      ["gyeonggi7800", 0],
      ["gyeonggi7800", 2],
    ]);
  });
});

describe("BusRegistryService.routeOf", () => {
  it("rejects a missing route with a 503 JONGRO_REGISTRY_UNAVAILABLE and logs it at error", async () => {
    // Act & Assert
    await expect(service.routeOf("jongro02")).rejects.toMatchObject({ code: "JONGRO_REGISTRY_UNAVAILABLE", httpStatus: 503 });
    expect(callsOf("error", "bus.jongro.registry_missing").map(([fields]) => fields.routeId)).toEqual(["jongro02"]);
  });

  it("serves a read for 30 s, then reads the store again", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    storeRoutes();
    await service.routeOf("jongro07");
    repository.routes.get("jongro07")!.stationsVersion = "changed";

    // Act
    const cached = await service.routeOf("jongro07");
    jest.setSystemTime(NOW.getTime() + 30_001);
    const reread = await service.routeOf("jongro07");

    // Assert
    expect(cached.stationsVersion).not.toBe("changed");
    expect(reread.stationsVersion).toBe("changed");
  });
});

describe("BusRegistryService.observe", () => {
  const captured08 = () => capturedStationsOf("jongro08");
  const withAddedStop = () => [...captured08().slice(0, 10), { topisId: "NEW", arsId: "09999", stationName: "새 정류장" }, ...captured08().slice(10)];

  beforeEach(() => {
    storeRoutes();
  });

  it("applies a drifted list at the third identical tick, logs its diff, and serves it at once", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 2);
    const beforeThird = storedStationsOf("jongro08");
    await observeTimes("jongro08", withAddedStop(), 1);

    // Assert
    expect(beforeThird).toEqual(captured08());
    expect(storedStationsOf("jongro08")).toEqual(withAddedStop());
    expect((await service.routeOf("jongro08")).topisIds).toHaveLength(32);
    const synced = callsOf("warn", "bus.jongro.registry_synced");
    expect(synced).toHaveLength(1);
    expect(synced[0]![0]).toMatchObject({
      code: "08",
      added: [{ ord: 11, topisId: "NEW", stationName: "새 정류장" }],
      removed: [],
      renamed: [],
    });
    expect(synced[0]![0].fromVersion).not.toBe(synced[0]![0].toVersion);
  });

  it("does not apply a flapping answer", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 2);
    await observeTimes("jongro08", captured08(), 1);
    await observeTimes("jongro08", withAddedStop(), 2);

    // Assert
    expect(storedStationsOf("jongro08")).toEqual(captured08());
  });

  it("ignores an overnight no-result answer, which neither changes the stations nor the count", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 2);
    await observeTimes("jongro08", [], 1);
    const afterEmpty = storedStationsOf("jongro08");
    await observeTimes("jongro08", withAddedStop(), 1);

    // Assert
    expect(afterEmpty).toEqual(captured08());
    expect(storedStationsOf("jongro08")).toEqual(withAddedStop());
  });

  it("holds a change to more than 30% of the stops and logs it at error once over five ticks", async () => {
    // Arrange
    const wrongRoute = captured08().map((s, index) => (index < 10 ? { ...s, topisId: `OTHER${index}` } : s));

    // Act
    await observeTimes("jongro08", wrongRoute, 5);

    // Assert
    expect(storedStationsOf("jongro08")).toEqual(captured08());
    const held = callsOf("error", "bus.jongro.registry_change_held");
    expect(held).toHaveLength(1);
    expect(held[0]![0]).toMatchObject({ code: "08", observed: wrongRoute });
    expect(held[0]![0].removed).toHaveLength(10);
  });

  it("applies a rename at the third tick and names the stop with its old and new names", async () => {
    // Arrange
    const renamed = captured08().map((s, index) => (index === 4 ? { ...s, stationName: "새 이름" } : s));

    // Act
    await observeTimes("jongro08", renamed, 3);

    // Assert
    expect(storedStationsOf("jongro08")[4]!.stationName).toBe("새 이름");
    expect(callsOf("warn", "bus.jongro.registry_synced")[0]![0].renamed).toEqual([
      { ord: 5, topisId: captured08()[4]!.topisId, fromName: captured08()[4]!.stationName, toName: "새 이름" },
    ]);
  });

  it("follows the position rows' turnaround stop when they agree, at the third tick", async () => {
    // Arrange
    const otherStop = captured08()[20]!.topisId;

    // Act
    await observeTimes("jongro08", captured08(), 3, [otherStop, otherStop]);

    // Assert
    expect(repository.routes.get("jongro08")!.turnaroundTopisId).toBe(otherStop);
  });

  it("keeps the stored turnaround stop when no bus is running while a stop list is applied", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 3, []);

    // Assert
    expect(repository.routes.get("jongro08")!.turnaroundTopisId).toBe("100000153");
  });

  it("writes nothing over a version another writer stored first", async () => {
    // Arrange
    const route = await service.routeOf("jongro08");
    repository.routes.get("jongro08")!.stationsVersion = "operator-edit";

    // Act
    for (let i = 0; i < 3; i++) await service.observe(route, rowsOf(withAddedStop()), []);

    // Assert
    expect(storedStationsOf("jongro08")).toEqual(captured08());
    expect(callsOf("warn", "bus.jongro.registry_sync_conflict")).toHaveLength(1);
  });
});

describe("BusRegistryService.findRouteOf", () => {
  it("answers a stored route as routeOf does", async () => {
    // Arrange
    storeRoutes();

    // Act
    const route = await service.findRouteOf("jongro07");

    // Assert
    expect(route).toEqual(await service.routeOf("jongro07"));
  });

  it("answers null for a missing route and logs no error, since the poller bootstraps it", async () => {
    // Act
    const route = await service.findRouteOf("jongro07");

    // Assert
    expect(route).toBeNull();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it("rejects when the store cannot be read", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act & Assert
    await expect(service.findRouteOf("jongro07")).rejects.toThrow("atlas down");
  });
});

// WHY: a fresh database gets its routes from TOPIS through the poller, not a snapshot (ADR 0012, D3).
describe("BusRegistryService.bootstrap", () => {
  const route07 = jongroRoutes.find((route) => route.id === "jongro07")!;
  const captured07 = () => capturedStationsOf("jongro07");
  const TURNAROUND_07 = "100900028";

  async function bootstrapTimes(times: number, stations: readonly ObservedStation[], turnaroundIds: Array<string | undefined>): Promise<void> {
    for (let i = 0; i < times; i++) await service.bootstrap(route07, rowsOf(stations), turnaroundIds).catch(ignoreBootstrapping);
  }
  const outcomeOf = (stations: readonly ObservedStation[], turnaroundIds: Array<string | undefined>): Promise<unknown> =>
    service.bootstrap(route07, rowsOf(stations), turnaroundIds).then(() => "resolved", (err: unknown) => err);

  it("rejects each observation before the insert with the count so far, and resolves the one that inserts", async () => {
    // Act
    const outcomes: unknown[] = [];
    for (let i = 0; i < 3; i++) outcomes.push(await outcomeOf(captured07(), [TURNAROUND_07]));

    // Assert
    expect(outcomes.slice(0, 2)).toEqual([expect.any(BusRegistryBootstrappingError), expect.any(BusRegistryBootstrappingError)]);
    expect(outcomes.slice(0, 2)).toMatchObject([{ routeId: "jongro07", observationCount: 1 }, { routeId: "jongro07", observationCount: 2 }]);
    expect(outcomes[2]).toBe("resolved");
  });

  it("rejects an observation that counts nothing with the count so far", async () => {
    // Arrange
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);

    // Act
    const outcome = await outcomeOf(captured07(), []);

    // Assert
    expect(outcome).toBeInstanceOf(BusRegistryBootstrappingError);
    expect(outcome).toMatchObject({ observationCount: 2 });
  });

  it("resolves the insert that finds a document another writer stored first", async () => {
    // Arrange
    const operatorDoc = { ...storedJongroRouteDocuments(NOW).find((doc) => doc._id === "jongro07")!, stationsVersion: "operator-edit" };
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);
    repository.routes.set("jongro07", structuredClone(operatorDoc));

    // Act
    const outcome = await outcomeOf(captured07(), [TURNAROUND_07]);

    // Assert
    expect(outcome).toBe("resolved");
    expect(repository.routes.get("jongro07")).toEqual(operatorDoc);
  });

  it("inserts the route at the third identical observation, logs it, and serves it at once", async () => {
    // Act
    await bootstrapTimes(2, captured07(), [TURNAROUND_07, TURNAROUND_07]);
    const beforeThird = repository.routes.has("jongro07");
    await bootstrapTimes(1, captured07(), [TURNAROUND_07, TURNAROUND_07]);

    // Assert
    expect(beforeThird).toBe(false);
    expect(repository.routes.get("jongro07")).toEqual({
      _id: "jongro07",
      stations: captured07().map((station, index) => ({ ...station, sequence: index + 1 })),
      turnaroundTopisId: TURNAROUND_07,
      stationsVersion: toStationsVersion(captured07(), TURNAROUND_07),
      syncedAt: NOW,
    });
    expect((await service.routeOf("jongro07")).stations.filter((s) => s.isRotationStation).map((s) => s.stationName)).toEqual(["방송통신대앞"]);
    const bootstrapped = callsOf("warn", "bus.jongro.registry_bootstrapped");
    expect(bootstrapped).toHaveLength(1);
    expect(bootstrapped[0]![0]).toMatchObject({ code: "07", stationsVersion: toStationsVersion(captured07(), TURNAROUND_07), turnaroundTopisId: TURNAROUND_07 });
  });

  it("serves the inserted route at once though a read missed it just before", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);
    await expect(service.routeOf("jongro07")).rejects.toMatchObject({ httpStatus: 503 });

    // Act
    await bootstrapTimes(1, captured07(), [TURNAROUND_07]);

    // Assert
    expect((await service.routeOf("jongro07")).topisIds).toHaveLength(22);
  });

  it("counts nothing at night, when no position row names a turnaround stop", async () => {
    // Act
    await bootstrapTimes(3, captured07(), []);
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);

    // Assert
    expect(repository.routes.has("jongro07")).toBe(false);
    expect(callsOf("warn", "bus.jongro.registry_bootstrapped")).toEqual([]);
  });

  it("counts nothing for an empty list or position rows that disagree", async () => {
    // Act
    await bootstrapTimes(2, [], [TURNAROUND_07]);
    await bootstrapTimes(2, captured07(), [TURNAROUND_07, "100900197"]);

    // Assert
    expect(repository.routes.has("jongro07")).toBe(false);
  });

  it("starts the count over when the list changes", async () => {
    // Act
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);
    await bootstrapTimes(1, captured07().slice(1), [TURNAROUND_07]);
    await bootstrapTimes(2, captured07(), [TURNAROUND_07]);

    // Assert
    expect(repository.routes.has("jongro07")).toBe(false);
  });

  it("keeps a document another writer stored between the third observation and the insert", async () => {
    // Arrange
    const operatorDoc = { ...storedJongroRouteDocuments(NOW).find((doc) => doc._id === "jongro07")!, stationsVersion: "operator-edit" };
    const insert = repository.insertRoute.bind(repository);
    repository.insertRoute = async (doc) => {
      repository.routes.set("jongro07", structuredClone(operatorDoc));
      return insert(doc);
    };

    // Act
    await bootstrapTimes(3, captured07().slice(0, 13), [TURNAROUND_07]);

    // Assert
    expect(repository.routes.get("jongro07")).toEqual(operatorDoc);
    expect(callsOf("warn", "bus.jongro.registry_bootstrapped")).toEqual([]);
    expect((await service.routeOf("jongro07")).stationsVersion).toBe("operator-edit");
  });
});

// WHY: 7800 joins the TOPIS route list unlisted (docs/plans/7800-unified-arrivals.md, Q2), so the config's read of
// every route never reads it, while the live route and the stop index read it by id.
describe("BusRegistryService over 7800's capture", () => {
  const sightingTurnarounds = () => sightings7800().map((sighting) => sighting.turnaroundStationId);

  it("lists only the routes /bus/config lists, even with 7800 stored", async () => {
    // Arrange
    storeRoutes();
    repository.routes.set("gyeonggi7800", registryDoc7800(NOW));

    // Act
    const routes = await service.listRoutes();

    // Assert
    expect(routes.map((route) => route.id)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });

  it("lists the Jongno routes with 7800 missing, and logs no missing route", async () => {
    // Arrange
    storeRoutes();

    // Act
    const routes = await service.listRoutes();

    // Assert
    expect(routes).toHaveLength(3);
    expect(callsOf("error", "bus.jongro.registry_missing")).toEqual([]);
  });

  it("inserts 7800 at the third tick of its capture: 80 stations, both directions, turning back at 사당역 (seq 39)", async () => {
    // Arrange
    const tick = () => service.bootstrap(ROUTE_7800, arrivalDocs7800(), sightingTurnarounds()).catch(ignoreBootstrapping);
    await tick();
    await tick();

    // Act
    await tick();

    // Assert
    const route = await service.routeOf("gyeonggi7800");
    expect([route.code, route.busRouteId, route.isListed, route.registryStations.length, route.turnaroundTopisId]).toEqual(["7800", "200000150", false, 80, TURNAROUND_7800]);
    expect(route.stations.findIndex((station) => station.isRotationStation)).toBe(38);
    expect(route.passThroughOrds.size).toBe(19);
    expect(callsOf("warn", "bus.jongro.registry_bootstrapped")).toHaveLength(1);
  });

  it("finds the captured list unchanged on every later tick: nothing pending, held or synced", async () => {
    // Arrange
    repository.routes.set("gyeonggi7800", registryDoc7800(NOW));
    const route = await service.routeOf("gyeonggi7800");

    // Act
    for (let i = 0; i < 4; i++) await service.observe(route, arrivalDocs7800(), sightingTurnarounds());

    // Assert
    const events = mockedLogger.warn.mock.calls.concat(mockedLogger.error.mock.calls).map(([fields]) => fields?.event);
    expect(events.filter((event) => String(event).startsWith("bus.jongro.registry_"))).toEqual([]);
    expect(repository.routes.get("gyeonggi7800")).toEqual(registryDoc7800(NOW));
  });
});
