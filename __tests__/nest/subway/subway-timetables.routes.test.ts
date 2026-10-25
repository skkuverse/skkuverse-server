/**
 * The readers of the stored `subway-timetables` dataset, over main.ts's pipeline with every
 * repository and upstream client faked, the stored topology's revision 1, the
 * poller registry replaced by one that records each tick, and the trimmed
 * fixture of revision 1 stored in FakeSubwayTimetableRepository:
 *
 * - The app reads no table at boot.
 * - Live arrivals fresh: `GET /subway/stations/:id/arrivals` reads no table,
 *   and answers 200 even when the timetables cannot be read.
 * - Night request: a timetable-only answer reads its line's table once, and
 *   later requests are served from the held copy.
 * - Never read: an answer that needs a table answers 503
 *   SUBWAY_TIMETABLES_UNAVAILABLE with no Cache-Control.
 * - Timetable pushed without a deploy: a 4호선 weekday train moved by two
 *   minutes is served at its new time once the dataset TTL has passed.
 * - Poller tick without a table: the `subway-seoul` tick writes every other
 *   platform's arrivals, then rejects, so the poller registry reports it.
 *
 * Each test boots its own app over its own stores, so no dataset cache crosses
 * tests. A push lands within the TTL through Jest's fake system time, which
 * `createCachedLoader` reads; the clock reads it too.
 */
import { Global, Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { CalendarModule } from "../../../src/calendar/calendar.module";
import { CalendarRepository } from "../../../src/calendar/calendar.repository";
import { Clock } from "../../../src/infra/clock";
import { toKstInstant } from "../../../src/shared/kst-date.util";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayMatchingModule } from "../../../src/subway/matching/subway-matching.module";
import { SubwaySeoulApiClient } from "../../../src/subway/seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiModule } from "../../../src/subway/seoul-api/subway-seoul-api.module";
import { SubwaySeoulTrainmapClient } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapModule } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.module";
import { SubwaySeoulModule } from "../../../src/subway/seoul/subway-seoul.module";
import type { SubwayArrivalsDoc } from "../../../src/subway/subway.document";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SUBWAY_STATIONS } from "../../../src/subway/subway.constants";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTimetableRepository } from "../../../src/subway/timetable/subway-timetable.repository";
import type { Timetable } from "../../../src/subway/timetable/subway-timetable.types";
import { SubwayTopologyModule } from "../../../src/subway/topology/subway-topology.module";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { FakeCalendarRepository } from "../../helpers/fakes/calendar/calendar.repository.fake";
import { FakeSubwaySeoulApiClient } from "../../helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import type { FakeSubwayTimetableRepository } from "../../helpers/fakes/subway/subway-timetable.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { storedSubwayTimetableRepository, subwayTimetableFixtureFiles } from "../../helpers/subway/timetables";
import { storedSubwayTopologyRepository } from "../../helpers/subway/topology";
import seeded from "./fixtures/subway-arrivals-seed.json";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

type Tick = () => Promise<unknown>;

// WHY: 10:12 KST on Tuesday 2026-10-20, inside the service window, the instant the seeded state was generated for.
const DAY = new Date("2026-10-20T01:12:46.000Z");
// WHY: 02:00 KST on Tuesday 2026-10-20, the service day of Monday, with no train left: every platform is served
// from its timetable alone, whatever state is stored.
const NIGHT = new Date("2026-10-19T17:00:00.000Z");
const CLOCK: Clock = { now: () => new Date(Date.now()) };
const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const UNAVAILABLE_CODE = "SUBWAY_TIMETABLES_UNAVAILABLE";

interface Stores {
  timetables: FakeSubwayTimetableRepository;
  state: FakeSubwayRepository;
  ticks: Map<string, Tick>;
}

function freshState(): FakeSubwayRepository {
  const repository = new FakeSubwayRepository();
  for (const doc of seeded.docs) {
    const toTrains = (trains: readonly unknown[]) =>
      (trains as Array<SubwayArrivalsDoc["directions"]["up"][number] & { arrivalAt: string }>).map((train) => ({ ...train, arrivalAt: new Date(train.arrivalAt) }));
    repository.docs.set(doc._id, { ...doc, generatedAt: new Date(doc.generatedAt), directions: { up: toTrains(doc.directions.up), down: toTrains(doc.directions.down) } });
  }
  return repository;
}

/** The trimmed fixture's tables, revision 1's trains around the pinned instants. */
const fixtureTables = (): Timetable[] => subwayTimetableFixtureFiles().map(({ table }) => table);

function storesHolding(tables: readonly Timetable[], state = new FakeSubwayRepository()): Stores {
  return { timetables: storedSubwayTimetableRepository(tables), state, ticks: new Map<string, Tick>() };
}

const apps: NestExpressApplication[] = [];

async function boot(stores: Stores): Promise<NestExpressApplication> {
  const registry = { registerPoller: (fn: Tick, _intervalMs: number, name: string): void => void stores.ticks.set(name, fn) };
  // Stands in for the @Global SchedulingModule, which provides the registry in main.ts; it records each tick by name.
  @Global()
  @Module({ providers: [{ provide: PollerRegistryService, useValue: registry }], exports: [PollerRegistryService] })
  class SchedulingStubModule {}
  const app = await buildTestApp({
    imports: [
      SchedulingStubModule,
      CalendarModule,
      SubwayModule,
      SubwayTopologyModule,
      SubwayTimetableModule,
      SubwayEstimateModule,
      SubwaySeoulApiModule,
      SubwaySeoulTrainmapModule,
      SubwayTrackingModule,
      SubwayMatchingModule,
      SubwaySeoulModule,
      SubwayArrivalsModule,
    ],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: CalendarRepository, useValue: new FakeCalendarRepository() },
      { provide: SubwayRepository, useValue: stores.state },
      { provide: SubwayTopologyRepository, useValue: storedSubwayTopologyRepository() },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: SubwayTimetableRepository, useValue: stores.timetables },
      { provide: SubwaySeoulApiClient, useValue: new FakeSubwaySeoulApiClient() },
      { provide: SubwaySeoulTrainmapClient, useValue: new FakeSubwaySeoulTrainmapClient() },
      { provide: Clock, useValue: CLOCK },
    ],
  });
  apps.push(app);
  return app;
}

const at = (instant: Date): void => {
  jest.useFakeTimers({ now: instant, doNotFake: [...DO_NOT_FAKE] });
};

afterEach(async () => {
  jest.useRealTimers();
  for (const app of apps.splice(0)) await app.close();
});

const arrivalsOf = (app: NestExpressApplication, stationId: string) => request(app.getHttpServer()).get(`/subway/stations/${stationId}/arrivals`);
const partKeys = (stores: Stores): string[] => stores.timetables.tableReads.map((partId) => partId.replace(/^subway-timetables\/|@.*$/g, ""));

describe("the subway timetables at boot", () => {
  it("boots and reads no table", async () => {
    // Arrange
    at(DAY);
    const stores = storesHolding(fixtureTables());

    // Act
    await boot(stores);

    // Assert
    expect(stores.timetables.tableReads).toEqual([]);
    expect(stores.timetables.manifestReads).toBe(0);
  });
});

describe("GET /subway/stations/:stationId/arrivals with the stored timetables", () => {
  it("Live arrivals fresh: serves 혜화 from its fresh state, reading no table", async () => {
    // Arrange
    at(DAY);
    const stores = storesHolding(fixtureTables(), freshState());
    const app = await boot(stores);

    // Act
    const res = await arrivalsOf(app, "hyehwa");

    // Assert
    expect(res.status).toBe(200);
    expect(stores.timetables.tableReads).toEqual([]);
  });

  it("Live arrivals do not need a table: answers 혜화 200 with its live arrivals while the timetables cannot be read", async () => {
    // Arrange
    at(DAY);
    const stores = storesHolding(fixtureTables(), freshState());
    stores.timetables.failWith = new Error("server selection timed out");
    const app = await boot(stores);

    // Act
    const res = await arrivalsOf(app, "hyehwa");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=5");
    expect(res.body.data.lines[0].generatedAt).toBe(toKstInstant(Date.parse(seeded.docs.find((doc) => doc._id === "S1-4-420")!.generatedAt)));
  });

  it("Night request: reads S1-4-weekday once for three answers of 혜화 at 02:00 on a Tuesday", async () => {
    // Arrange
    at(NIGHT);
    const stores = storesHolding(fixtureTables());
    const app = await boot(stores);

    // Act
    const answers = [await arrivalsOf(app, "hyehwa"), await arrivalsOf(app, "hyehwa"), await arrivalsOf(app, "hyehwa")];

    // Assert
    expect(answers.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(partKeys(stores)).toEqual(["S1-4-weekday"]);
  });

  it("Fallback needs a table: answers 혜화 503 SUBWAY_TIMETABLES_UNAVAILABLE with no Cache-Control when it never read S1-4-weekday and the database is unreachable", async () => {
    // Arrange
    at(NIGHT);
    const stores = storesHolding(fixtureTables());
    stores.timetables.failWith = new Error("server selection timed out");
    const app = await boot(stores);

    // Act
    const res = await arrivalsOf(app, "hyehwa");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: UNAVAILABLE_CODE, message: "The subway timetables are unavailable: S1-4-weekday" } });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("Timetable pushed without a deploy: serves 혜화's first train down at its new time once the TTL has passed after a push moving it two minutes", async () => {
    // Arrange
    const instant = new Date("2026-10-20T23:00:00.000Z");
    at(instant);
    const tables = fixtureTables();
    const stores = storesHolding(tables);
    const app = await boot(stores);
    const before = await arrivalsOf(app, "hyehwa");
    const firstDown = before.body.data.lines[0].directions[1].trains[0];
    const moved = tables.map((table) =>
      table.operator === "S1" && table.line === "4" && table.dayType === "weekday"
        ? {
            ...table,
            trains: table.trains.map((train) =>
              train.trainNo === firstDown.trainNo ? { ...train, stops: train.stops.map((stop) => ({ ...stop, arr: stop.arr && stop.arr + 120, dep: stop.dep && stop.dep + 120 })) } : train,
            ),
          }
        : table,
    );
    stores.timetables.storeTables(moved);

    // Act
    const withinTtl = await arrivalsOf(app, "hyehwa");
    jest.setSystemTime(instant.getTime() + DATASET_CACHE_TTL_MS);
    const after = await arrivalsOf(app, "hyehwa");

    // Assert
    const arrivalOf = (res: request.Response) => res.body.data.lines[0].directions[1].trains.find((train: { trainNo: string }) => train.trainNo === firstDown.trainNo)?.scheduledArrivalAt;
    expect(arrivalOf(withinTtl)).toBe(firstDown.scheduledArrivalAt);
    expect(arrivalOf(after)).toBe(toKstInstant(Date.parse(firstDown.scheduledArrivalAt) + 120_000));
  });
});

describe("the Seoul pollers with the stored timetables", () => {
  it("Poller tick without a table: the subway-seoul tick writes every other platform's arrivals, then rejects naming KR-1-weekday", async () => {
    // Arrange
    at(DAY);
    const tables = fixtureTables().filter((table) => !(table.line === "1" && table.dayType === "weekday"));
    const stores = storesHolding(tables);
    await boot(stores);

    // Act
    const failure = await stores.ticks.get("subway-seoul")!().catch((err: unknown) => err);

    // Assert
    expect(failure).toMatchObject({ code: UNAVAILABLE_CODE, httpStatus: 503, keys: ["KR-1-weekday"] });
    const others = SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id)).filter((id) => !["KR-1-P153", "KR-1-P149", "S1-1-154"].includes(id));
    expect([...stores.state.docs.keys()]).toEqual(others);
  });
});
