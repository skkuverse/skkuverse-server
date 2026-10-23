/**
 * The readers of the stored `subway-topology` dataset, over main.ts's pipeline with every repository and
 * upstream client faked, the poller registry replaced by one that records each
 * tick, and the clock at 10:12 KST on Tuesday 2026-10-20, every platform's
 * arrival state fresh:
 *
 * - `GET /subway/stations/:id/arrivals` names each direction and its previous
 *   and next stations from the stored topology, and a push that renames a
 *   neighbor is served once the dataset TTL has passed.
 * - Topology never read: the route answers 503 SUBWAY_TOPOLOGY_UNAVAILABLE
 *   with no Cache-Control, and each Seoul poller tick rejects before any
 *   upstream call.
 * - A served platform the stored topology lacks is left out of its station,
 *   which answers 200 with its other platform; an entry for a platform the
 *   code does not serve changes no answer, and a neighbor such a push promotes
 *   to a served platform, its neighbor entry dropped, is served as a null
 *   previous or next station.
 * - The Seoul API poller matches rows at a neighbor a push adds once the TTL
 *   has passed, and keeps matching with the last good topology through a
 *   failed reload.
 *
 * Each test boots its own app over its own stores, so no dataset cache crosses
 * tests. A push lands within the TTL through Jest's fake system time, which
 * `createCachedLoader` reads; the clock reads it too.
 */
import { Global, Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { HolidaysModule } from "../../../src/holidays/holidays.module";
import { HolidaysRepository } from "../../../src/holidays/holidays.repository";
import { Clock } from "../../../src/infra/clock";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import { DATASET_CACHE_TTL_MS } from "../../../src/shared/dataset.constants";
import { SubwayArrivalsModule } from "../../../src/subway/arrivals/subway-arrivals.module";
import { SubwayEstimateModule } from "../../../src/subway/estimate/subway-estimate.module";
import { SubwayMatchingModule } from "../../../src/subway/matching/subway-matching.module";
import { SubwaySeoulApiClient } from "../../../src/subway/seoul-api/subway-seoul-api.client";
import { SubwaySeoulApiModule } from "../../../src/subway/seoul-api/subway-seoul-api.module";
import type { SeoulPositionRow } from "../../../src/subway/seoul-api/subway-seoul-api.schema";
import { SubwaySeoulTrainmapClient } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.client";
import { SubwaySeoulTrainmapModule } from "../../../src/subway/seoul-trainmap/subway-seoul-trainmap.module";
import { SubwaySeoulModule } from "../../../src/subway/seoul/subway-seoul.module";
import { SubwaySeoulService } from "../../../src/subway/seoul/subway-seoul.service";
import type { SubwayArrivalsDoc } from "../../../src/subway/subway.document";
import { SubwayModule } from "../../../src/subway/subway.module";
import { SubwayRepository } from "../../../src/subway/subway.repository";
import { SubwayTimetableModule } from "../../../src/subway/timetable/subway-timetable.module";
import { SubwayTopologyModule } from "../../../src/subway/topology/subway-topology.module";
import { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { SubwayStationCoordsRepository } from "../../../src/subway/station-coords/subway-station-coords.repository";
import { storedStationCoordsRepository } from "../../helpers/subway/station-coords";
import type { SubwayTopologyData } from "../../../src/subway/topology/subway-topology.types";
import { SubwayTrackingModule } from "../../../src/subway/tracking/subway-tracking.module";
import { FakeHolidaysRepository } from "../../helpers/fakes/holidays/holidays.repository.fake";
import { FakeSubwaySeoulApiClient } from "../../helpers/fakes/subway/subway-seoul-api.client.fake";
import { FakeSubwaySeoulTrainmapClient } from "../../helpers/fakes/subway/subway-seoul-trainmap.client.fake";
import { FakeSubwayTopologyRepository } from "../../helpers/fakes/subway/subway-topology.repository.fake";
import { FakeSubwayRepository } from "../../helpers/fakes/subway/subway.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { subwayTopologyFixture } from "../../helpers/subway/topology";
import seeded from "./fixtures/subway-arrivals-seed.json";

type Tick = () => Promise<unknown>;

const positionRows = require("./fixtures/realtime-position-line1.json").realtimePositionList as SeoulPositionRow[];

// WHY: 10:12 KST on a Tuesday, inside the service window, the instant the seeded state was generated for.
const NOW = new Date("2026-10-20T01:12:46.000Z");
const CLOCK: Clock = { now: () => new Date(Date.now()) };
const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const UNAVAILABLE = { code: "SUBWAY_TOPOLOGY_UNAVAILABLE", message: "The subway topology is unavailable" };

interface Stores {
  topology: FakeSubwayTopologyRepository;
  apiClient: FakeSubwaySeoulApiClient;
  trainmapClient: FakeSubwaySeoulTrainmapClient;
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

function storesHolding(topology: SubwayTopologyData | null): Stores {
  const stores = { topology: new FakeSubwayTopologyRepository(), apiClient: new FakeSubwaySeoulApiClient(), trainmapClient: new FakeSubwaySeoulTrainmapClient(), ticks: new Map<string, Tick>() };
  if (topology !== null) stores.topology.storeTopology(topology);
  return stores;
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
      HolidaysModule,
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
      { provide: HolidaysRepository, useValue: new FakeHolidaysRepository() },
      { provide: SubwayRepository, useValue: freshState() },
      { provide: SubwayTopologyRepository, useValue: stores.topology },
      { provide: SubwayStationCoordsRepository, useValue: storedStationCoordsRepository() },
      { provide: SubwaySeoulApiClient, useValue: stores.apiClient },
      { provide: SubwaySeoulTrainmapClient, useValue: stores.trainmapClient },
      { provide: Clock, useValue: CLOCK },
    ],
  });
  apps.push(app);
  return app;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: [...DO_NOT_FAKE] });
});

afterEach(async () => {
  jest.useRealTimers();
  for (const app of apps.splice(0)) await app.close();
});

const pastTtl = (): void => {
  jest.setSystemTime(NOW.getTime() + DATASET_CACHE_TTL_MS);
};

const arrivalsOf = (app: NestExpressApplication, stationId: string, lang = "ko") =>
  request(app.getHttpServer()).get(`/subway/stations/${stationId}/arrivals`).set("Accept-Language", lang);

type WireDirection = { direction: string; name: string; previousStation: { id: string; name: string } | null; nextStation: { id: string; name: string } | null };
const directionsOf = (body: { data: { lines: Array<{ platformId: string; directions: WireDirection[] }> } }, platformId: string) =>
  body.data.lines.find((line) => line.platformId === platformId)?.directions;

/** A copy of a captured line 1 position row, its train arrived at `stationName`. */
function arrivedAt(stationName: string): SeoulPositionRow {
  return { ...positionRows[0]!, statnNm: stationName, trainSttus: "1" };
}

describe("GET /subway/stations/:stationId/arrivals with the stored topology", () => {
  it("names Sungkyunkwan Univ.'s directions and their previous and next stations from revision 1", async () => {
    // Arrange
    const app = await boot(storesHolding(subwayTopologyFixture()));

    // Act
    const res = await arrivalsOf(app, "sungkyunkwan", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(directionsOf(res.body, "KR-1-0153")?.map(({ direction, name, previousStation, nextStation }) => [direction, name, previousStation, nextStation])).toEqual([
      ["up", "Toward Seoul", { id: "KR-1-P154", name: "Hwaseo" }, { id: "KR-1-P152", name: "Uiwang" }],
      ["down", "Toward Cheonan / Seodongtan", { id: "KR-1-P152", name: "Uiwang" }, { id: "KR-1-P154", name: "Hwaseo" }],
    ]);
  });

  it("Neighbor renamed: names KR-1-P154 Hwaseo Stn. in English once the TTL has passed after the push, and not before", async () => {
    // Arrange
    const stores = storesHolding(subwayTopologyFixture());
    const app = await boot(stores);
    await arrivalsOf(app, "sungkyunkwan", "en");
    const renamed = subwayTopologyFixture();
    renamed.neighbors["KR-1-P154"] = { ...renamed.neighbors["KR-1-P154"]!, name: { ko: "화서", en: "Hwaseo Stn.", zh: "华西" } };
    stores.topology.storeTopology(renamed);

    // Act
    const withinTtl = await arrivalsOf(app, "sungkyunkwan", "en");
    pastTtl();
    const after = await arrivalsOf(app, "sungkyunkwan", "en");

    // Assert
    expect(directionsOf(withinTtl.body, "KR-1-0153")?.[0]?.previousStation).toEqual({ id: "KR-1-P154", name: "Hwaseo" });
    expect(directionsOf(after.body, "KR-1-0153")?.[0]?.previousStation).toEqual({ id: "KR-1-P154", name: "Hwaseo Stn." });
  });

  it("Fresh replica, database down: answers 503 SUBWAY_TOPOLOGY_UNAVAILABLE with no Cache-Control", async () => {
    // Arrange
    const stores = storesHolding(subwayTopologyFixture());
    stores.topology.failWith = new Error("server selection timed out");
    const app = await boot(stores);

    // Act
    const res = await arrivalsOf(app, "hyehwa");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: UNAVAILABLE });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("answers 503 SUBWAY_TOPOLOGY_UNAVAILABLE with no topology stored", async () => {
    // Arrange
    const app = await boot(storesHolding(null));

    // Act
    const res = await arrivalsOf(app, "sungkyunkwan");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: UNAVAILABLE });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("Deploy ahead of the topology: answers Gangnam 200 with its Shinbundang platform only when S1-2-222 has no entry", async () => {
    // Arrange
    const lacking = subwayTopologyFixture();
    delete lacking.platforms["S1-2-222"];
    const app = await boot(storesHolding(lacking));

    // Act
    const res = await arrivalsOf(app, "gangnam");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=5");
    expect(res.body.data.lines.map((line: { platformId: string }) => line.platformId)).toEqual(["DX-D1-4307"]);
  });

  it("Deploy ahead of the topology: still names a served platform the topology lacks by its station when another platform's direction names it", async () => {
    // Arrange
    const lacking = subwayTopologyFixture();
    delete lacking.platforms["DX-D1-4308"];
    const app = await boot(storesHolding(lacking));

    // Act
    const res = await arrivalsOf(app, "gangnam", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(directionsOf(res.body, "DX-D1-4307")?.[0]?.previousStation).toEqual({ id: "DX-D1-4308", name: "Yangjae" });
  });

  it("Topology pushed ahead of a deploy: answers every station as revision 1 does when an entry names a platform the code does not serve", async () => {
    // Arrange
    const ahead = subwayTopologyFixture();
    ahead.platforms["S1-9-999"] = ahead.platforms["S1-4-420"]!;
    const plain = await boot(storesHolding(subwayTopologyFixture()));
    const app = await boot(storesHolding(ahead));
    const stationIds = ["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang"];

    // Act
    const answers = await Promise.all(stationIds.map(async (stationId) => [(await arrivalsOf(app, stationId)).text, (await arrivalsOf(plain, stationId)).text]));

    // Assert
    expect(answers.map(([pushed]) => JSON.parse(pushed!).data.station.id)).toEqual(stationIds);
    for (const [pushed, expected] of answers) expect(pushed).toBe(expected);
  });

  it("Topology pushed ahead of a deploy: answers Sungkyunkwan 200, its previous station up and next station down null, when a push promotes neighbor KR-1-P154 to a platform", async () => {
    // Arrange
    const ahead = subwayTopologyFixture();
    ahead.platforms["KR-1-P154"] = ahead.platforms["KR-1-0153"]!;
    delete ahead.neighbors["KR-1-P154"];
    const app = await boot(storesHolding(ahead));

    // Act
    const res = await arrivalsOf(app, "sungkyunkwan", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(directionsOf(res.body, "KR-1-0153")?.map(({ direction, previousStation, nextStation }) => [direction, previousStation, nextStation])).toEqual([
      ["up", null, { id: "KR-1-P152", name: "Uiwang" }],
      ["down", { id: "KR-1-P152", name: "Uiwang" }, null],
    ]);
  });

  it("answers 404 SUBWAY_STATION_NOT_FOUND for a platform id, which the topology keys but no station is", async () => {
    // Arrange
    const app = await boot(storesHolding(subwayTopologyFixture()));

    // Act
    const res = await arrivalsOf(app, "s1-4-420");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SUBWAY_STATION_NOT_FOUND");
  });
});

describe("the Seoul pollers with the stored topology", () => {
  it.each(["subway-seoul", "subway-trainmap"])("Poller without a topology: rejects the %s tick before any upstream call", async (name) => {
    // Arrange
    const stores = storesHolding(null);
    await boot(stores);

    // Act
    const failure = await stores.ticks.get(name)!().catch((err: unknown) => err);

    // Assert
    expect(failure).toMatchObject({ code: UNAVAILABLE.code, httpStatus: 503 });
    expect(stores.apiClient.calls).toEqual([]);
    expect(stores.trainmapClient.calls).toEqual([]);
  });

  it("Neighbor added: keeps a row at 관악 as an event at KR-1-P146 once the TTL has passed after the push, and drops it before", async () => {
    // Arrange
    const stores = storesHolding(subwayTopologyFixture());
    stores.apiClient.positions.set("1호선", [arrivedAt("관악")]);
    const app = await boot(stores);
    const seoul = app.get(SubwaySeoulService);
    await seoul.observeApi();
    const added = subwayTopologyFixture();
    added.neighbors["KR-1-P146"] = { line: "1", seoulName: "관악" };
    stores.topology.storeTopology(added);

    // Act
    const before = await seoul.observeApi();
    pastTtl();
    const after = await seoul.observeApi();

    // Assert
    expect(before.events.map((event) => event.platformId)).toEqual([]);
    expect(after.events.map((event) => event.platformId)).toEqual(["KR-1-P146"]);
  });

  it("Database blip after a good read: keeps matching rows with the last loaded topology while reloads fail", async () => {
    // Arrange
    const stores = storesHolding(subwayTopologyFixture());
    stores.apiClient.positions.set("1호선", [arrivedAt("의왕")]);
    const app = await boot(stores);
    const seoul = app.get(SubwaySeoulService);
    await seoul.observeApi();
    stores.topology.failWith = new Error("server selection timed out");

    // Act
    pastTtl();
    const observed = await seoul.observeApi();

    // Assert
    expect(observed.events.map((event) => event.platformId)).toEqual(["KR-1-P152"]);
  });
});
