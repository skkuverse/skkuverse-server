/**
 * BusRegistryService over an in-memory registry repository and a fixed clock
 * (improve-jongro-realtime D6–D9): every boot seeds a missing route from the
 * committed snapshot and never overwrites a stored one; a seeded route
 * derives the stations, mapping and URLs production served from
 * jongro-routes.json; a missing document fails with a 503 and an error line;
 * reads are cached for 30 s; and the poller's observations follow TOPIS's
 * stop list: applied at the third identical tick, held over 30%, an empty
 * list ignored, every applied change logged with its diff.
 */
jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import { FakeBusRegistryRepository } from "../../../__tests__/helpers/fakes/bus/bus-registry.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { logText } from "../../../__tests__/helpers/log-text";
import type { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { stationsSeed } from "./bus-registry.config";
import type { BusRegistryRepository } from "./bus-registry.repository";
import { toStationsVersion } from "./bus-registry.rules";
import { BusRegistryService } from "./bus-registry.service";
import type { ObservedStation, RegistryRoute } from "./bus-registry.types";

const NOW = new Date("2026-10-17T12:00:00Z");
const clock: Clock = { now: () => NOW };
const mockedLogger = logger as unknown as Record<"info" | "warn" | "error", jest.Mock>;
const callsOf = (level: "info" | "warn" | "error", event: string) => mockedLogger[level].mock.calls.filter(([fields]) => fields?.event === event);

let repository: FakeBusRegistryRepository;
let service: BusRegistryService;

const seedOf = (routeId: string) => stationsSeed.find((seed) => seed.id === routeId)!;
const rowsOf = (stations: readonly ObservedStation[]) =>
  stations.map((s, index) => ({ stationId: s.topisId, sequence: String(index + 1), stationName: s.stationName, stationNumber: s.arsId }));
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

describe("BusRegistryService.onModuleInit", () => {
  it("seeds every configured route from the snapshot and logs one seed line each", async () => {
    // Act
    await service.onModuleInit();

    // Assert
    const seed07 = seedOf("jongro07");
    expect([...repository.routes.keys()]).toEqual(["jongro02", "jongro07", "jongro08"]);
    expect(repository.routes.get("jongro07")).toEqual({
      _id: "jongro07",
      stations: seed07.stations.map((s, index) => ({ ...s, sequence: index + 1 })),
      turnaroundTopisId: "100900028",
      stationsVersion: toStationsVersion(seed07.stations, "100900028"),
      syncedAt: NOW,
    });
    expect(callsOf("warn", "bus.jongro.registry_seeded").map(([fields]) => fields.routeId)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });

  it("keeps a stored document that differs from the snapshot, and logs no seed", async () => {
    // Arrange
    await service.onModuleInit();
    repository.routes.get("jongro07")!.stationsVersion = "operator-edit";
    jest.clearAllMocks();

    // Act
    await new BusRegistryService(asReal<BusRegistryRepository>(repository), clock).onModuleInit();

    // Assert
    expect(repository.routes.get("jongro07")!.stationsVersion).toBe("operator-edit");
    expect(callsOf("warn", "bus.jongro.registry_seeded")).toEqual([]);
  });

  it("logs a failed seed at error and lets the boot go on", async () => {
    // Arrange
    repository.failWith = new Error("atlas down");

    // Act
    await service.onModuleInit();

    // Assert
    expect(callsOf("error", "bus.jongro.registry_seed_failed")).toHaveLength(3);
  });
});

// The pins of jongro-routes.json before its stations moved here, read now from the seeded registry.
describe("BusRegistryService.routeOf over the seeded snapshot", () => {
  beforeEach(async () => {
    await service.onModuleInit();
  });

  it("builds 종로08 from TOPIS route 100900005: 31 stops, 회차 at 재향군인회관", async () => {
    // Act
    const r08 = await service.routeOf("jongro08");

    // Assert
    expect(r08.busRouteId).toBe("100900005");
    expect(r08.stations).toHaveLength(31);
    expect(r08.positionsUrl).toContain("&endOrd=31&");
    expect(r08.stations[0]!.isFirstStation).toBe(true);
    expect(r08.stations[0]!.stationName).toBe("명륜3가종점");
    expect(r08.stations[30]!.isLastStation).toBe(true);
    expect(r08.stations[30]!.stationName).toBe("샘미용실.종로구청소년상담복지센터");
    expect(r08.stations.filter((s) => s.isRotationStation).map((s) => s.stationName)).toEqual(["서울특별시재향군인회관"]);
    expect(r08.stations[15]!.isRotationStation).toBe(true);
    expect(r08.stations[16]!.stationName).toBe("종로5가역.광장시장");
    expect(r08.stations[16]!.transferLines).toEqual([{ line: "1", color: "0052A4" }]);
    expect(r08.stations[9]!.transferLines).toEqual([{ line: "4", color: "00A5DE" }]);
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
    expect(r07.positionsUrl).toContain("&endOrd=22&");
    expect(r02.positionsUrl).toContain("&endOrd=27&");
  });

  it("carries the transfer badges of the 2026-09 review on the stations they belong to", async () => {
    // Arrange
    const r02 = await service.routeOf("jongro02");
    const linesOf = (route: RegistryRoute, name: string, nth = 0) =>
      route.stations.filter((s) => s.stationName === name)[nth]!.transferLines.map((t) => t.line);

    // Assert
    expect(r02.stations[11]!.transferLines).toEqual([
      { line: "1", color: "0052A4" },
      { line: "3", color: "EF7C1C" },
      { line: "5", color: "996CAC" },
    ]);
    expect(linesOf(r02, "조계사")).toEqual(["1"]);
    expect(linesOf(r02, "가회동주민센터", 1)).toEqual(["3"]);
    expect(linesOf(await service.routeOf("jongro08"), "효제초교.연동교회.김마리아활동터")).toEqual(["1"]);
    expect(linesOf(await service.routeOf("jongro07"), "성대입구")).toEqual(["4"]);
  });

  it("lists every configured route", async () => {
    // Act & Assert
    expect((await service.listRoutes()).map((route) => route.id)).toEqual(["jongro02", "jongro07", "jongro08"]);
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
    await service.onModuleInit();
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

  it("warns once about a transfer override whose ARS number no stored station has", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    await service.onModuleInit();
    const doc = repository.routes.get("jongro02")!;
    doc.stations = doc.stations.filter((s) => s.arsId !== "01589");

    // Act
    await service.routeOf("jongro02");
    jest.setSystemTime(NOW.getTime() + 30_001);
    await service.routeOf("jongro02");

    // Assert
    const warnings = callsOf("warn", "bus.jongro.registry_unmatched_transfer");
    expect(warnings).toHaveLength(1);
    expect(logText(warnings[0])).toContain("01589");
  });
});

describe("BusRegistryService.observe", () => {
  const seed08 = () => seedOf("jongro08").stations;
  const withAddedStop = () => [...seed08().slice(0, 10), { topisId: "NEW", arsId: "09999", stationName: "새 정류장" }, ...seed08().slice(10)];

  beforeEach(async () => {
    await service.onModuleInit();
  });

  it("applies a drifted list at the third identical tick, logs its diff, and serves it at once", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 2);
    const beforeThird = storedStationsOf("jongro08");
    await observeTimes("jongro08", withAddedStop(), 1);

    // Assert
    expect(beforeThird).toEqual(seed08());
    expect(storedStationsOf("jongro08")).toEqual(withAddedStop());
    expect((await service.routeOf("jongro08")).positionsUrl).toContain("&endOrd=32&");
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
    await observeTimes("jongro08", seed08(), 1);
    await observeTimes("jongro08", withAddedStop(), 2);

    // Assert
    expect(storedStationsOf("jongro08")).toEqual(seed08());
  });

  it("ignores an overnight no-result answer, which neither changes the stations nor the count", async () => {
    // Act
    await observeTimes("jongro08", withAddedStop(), 2);
    await observeTimes("jongro08", [], 1);
    const afterEmpty = storedStationsOf("jongro08");
    await observeTimes("jongro08", withAddedStop(), 1);

    // Assert
    expect(afterEmpty).toEqual(seed08());
    expect(storedStationsOf("jongro08")).toEqual(withAddedStop());
  });

  it("holds a change to more than 30% of the stops and logs it at error once over five ticks", async () => {
    // Arrange
    const wrongRoute = seed08().map((s, index) => (index < 10 ? { ...s, topisId: `OTHER${index}` } : s));

    // Act
    await observeTimes("jongro08", wrongRoute, 5);

    // Assert
    expect(storedStationsOf("jongro08")).toEqual(seed08());
    const held = callsOf("error", "bus.jongro.registry_change_held");
    expect(held).toHaveLength(1);
    expect(held[0]![0]).toMatchObject({ code: "08", observed: wrongRoute });
    expect(held[0]![0].removed).toHaveLength(10);
  });

  it("applies a rename at the third tick and names the stop with its old and new names", async () => {
    // Arrange
    const renamed = seed08().map((s, index) => (index === 4 ? { ...s, stationName: "새 이름" } : s));

    // Act
    await observeTimes("jongro08", renamed, 3);

    // Assert
    expect(storedStationsOf("jongro08")[4]!.stationName).toBe("새 이름");
    expect(callsOf("warn", "bus.jongro.registry_synced")[0]![0].renamed).toEqual([
      { ord: 5, topisId: seed08()[4]!.topisId, fromName: seed08()[4]!.stationName, toName: "새 이름" },
    ]);
  });

  it("follows the position rows' turnaround stop when they agree, at the third tick", async () => {
    // Arrange
    const otherStop = seed08()[20]!.topisId;

    // Act
    await observeTimes("jongro08", seed08(), 3, [otherStop, otherStop]);

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
    expect(storedStationsOf("jongro08")).toEqual(seed08());
    expect(callsOf("warn", "bus.jongro.registry_sync_conflict")).toHaveLength(1);
  });
});
