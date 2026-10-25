/**
 * GET /internal/subway/accuracy over a real `mongod`, booting every module
 * `src/app.module.ts` imports from scheduling, holidays and subway with
 * ROLE=api, so no poller starts, and only `Clock` overridden. The known
 * records are written through the real SubwayHistoryRepository (its upsert,
 * its observed-arrival update and its unresolved sweep), so the errors the
 * report reads are the ones Mongo computed. What it guards: when
 * INTERNAL_AUTHORIZER (FakeInternalAuthorizer) refuses the call under
 * subway.accuracy, the answer is 401 with no data, before the range is read; a
 * malformed range is a 400; and the report groups the range's records by
 * station, direction, horizon and source, each with its count, nearest-rank
 * median error, median and p90 absolute error and unresolved count, leaving
 * out open records and other service dates, under `Cache-Control: no-store`.
 * A poller boot (ADR 0012: api creates nothing at boot) creates `subway_events`
 * as a time-series collection expiring after 180 days. On Mongo, an observed arrival resolves the records isResolvableBy
 * allows and no other: never one made at the tick that saw it (F6), an arrived
 * row replacing an approaching row's resolution, nothing predicted over 30
 * minutes before.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { InternalAuthorizer } from "../../../src/perimeter/perimeter.ports";
import type { SubwayPredictionDoc } from "../../../src/subway/history/subway-history.document";
import type { SubwayHistoryRepository } from "../../../src/subway/history/subway-history.repository";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { FakeInternalAuthorizer } from "../../helpers/fakes/perimeter/internal-authorizer.fake";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type HistoryRepositoryClass = typeof import("../../../src/subway/history/subway-history.repository")["SubwayHistoryRepository"];
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

const at = (iso: string): Date => new Date(`${iso}+09:00`);
const CLOCK = { now: (): Date => at("2026-10-17T10:00:00") };
const TOKEN = "test-internal-dispatch-token";
const WEEK = "/internal/subway/accuracy?from=2026-10-10&to=2026-10-16";
const internalAuthorizer = new FakeInternalAuthorizer();

let mongod: TestMongod;
let db: Db;
let config: Config;
let buildTestApp: BuildTestApp;
let SubwayHistoryRepositoryClass: HistoryRepositoryClass;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  SubwayHistoryRepositoryClass = (require("../../../src/subway/history/subway-history.repository") as { SubwayHistoryRepository: HistoryRepositoryClass })
    .SubwayHistoryRepository;
  await clearCollections(db.getClient().db(config.mongo.dbName));
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/calendar/", "src/subway/"),
    overrides: [
      { provide: Clock, useValue: CLOCK },
      { provide: InternalAuthorizer, useValue: internalAuthorizer },
    ],
    role: "api",
  });
}, MONGOD_START_TIMEOUT_MS + APP_BOOT_TIMEOUT_MS);

beforeEach(() => {
  internalAuthorizer.allowed = true;
  internalAuthorizer.calls.length = 0;
});

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

function prediction(overrides: Partial<SubwayPredictionDoc> & Pick<SubwayPredictionDoc, "trainNo" | "predictedAt">): SubwayPredictionDoc {
  return {
    serviceDate: "2026-10-16",
    stationId: "KR-1-P153",
    horizonMin: 3,
    direction: "up",
    source: "estimated",
    madeAt: new Date(overrides.predictedAt.getTime() - 3 * 60_000),
    status: "open",
    observedAt: null,
    observedState: null,
    resolvedAt: null,
    errorSec: null,
    ...overrides,
  };
}

/** Writes `predicted`, then resolves it with the arrival `errorSec` seconds before it, as the tracker's history would. */
async function resolved(repository: SubwayHistoryRepository, record: SubwayPredictionDoc, errorSec: number): Promise<void> {
  await repository.upsertPredictions([record]);
  const observedAt = new Date(record.predictedAt.getTime() - errorSec * 1000);
  const { serviceDate, trainNo, stationId } = record;
  await repository.updateObservedArrival({ serviceDate, trainNo, platformId: stationId, observedAt, observedState: "arrived" }, observedAt);
}

async function writeKnownRecords(repository: SubwayHistoryRepository): Promise<void> {
  const errorsUp3Estimated = [-20, 10, 40, -90];
  for (const [index, errorSec] of errorsUp3Estimated.entries()) {
    await resolved(repository, prediction({ trainNo: `06${10 + index}`, predictedAt: at(`2026-10-16T20:0${index}:30`) }), errorSec);
  }
  await resolved(repository, prediction({ trainNo: "0620", horizonMin: 5, predictedAt: at("2026-10-15T20:10:30") }), 30);
  await resolved(repository, prediction({ trainNo: "0630", source: "scheduled", predictedAt: at("2026-10-14T20:20:30") }), 60);
  await resolved(repository, prediction({ trainNo: "0640", serviceDate: "2026-10-09", predictedAt: at("2026-10-09T20:30:30") }), 500);
  await repository.upsertPredictions([
    prediction({ trainNo: "0650", predictedAt: at("2026-10-16T20:40:30") }),
    prediction({ trainNo: "4601", stationId: "S1-4-420", direction: "down", horizonMin: 1, source: "live", predictedAt: at("2026-10-16T20:41:00") }),
    prediction({ trainNo: "4603", stationId: "S1-4-420", direction: "down", horizonMin: 1, source: "live", predictedAt: at("2026-10-16T20:45:00") }),
  ]);
  await repository.updateUnresolvedPredictions(at("2026-10-16T21:00:00"), at("2026-10-16T21:30:00"));
  await repository.upsertPredictions([prediction({ trainNo: "0660", predictedAt: at("2026-10-16T23:40:30") })]);
}

describe("GET /internal/subway/accuracy", () => {
  it("answers 401 with no data without the internal token", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(app.getHttpServer()).get(WEEK);

    // Assert
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    expect(internalAuthorizer.calls.map(({ scope, request: asked }) => [scope, asked.target])).toEqual([["subway.accuracy", WEEK]]);
  });

  it("answers 401 with no data for a wrong token", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(app.getHttpServer()).get(WEEK).set("X-Internal-Token", "not-the-token");

    // Assert
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
  });

  it("answers 401, not 400, for a malformed range the authorizer refuses: a caller without the token learns nothing", async () => {
    // Arrange
    internalAuthorizer.allowed = false;

    // Act
    const res = await request(app.getHttpServer()).get("/internal/subway/accuracy?from=2026-10-16&to=2026-10-10");

    // Assert
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("answers 400 INVALID_ACCURACY_RANGE for a range whose end is before its start", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/internal/subway/accuracy?from=2026-10-16&to=2026-10-10").set("X-Internal-Token", TOKEN);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_ACCURACY_RANGE", message: "to must not be before from" } });
  });

  it("Weekly check: gives each station, direction, horizon and source its count, median error, median and p90 absolute error and unresolved count", async () => {
    // Arrange
    await writeKnownRecords(app.get<SubwayHistoryRepository>(SubwayHistoryRepositoryClass));

    // Act
    const res = await request(app.getHttpServer()).get(WEEK).set("X-Internal-Token", TOKEN);

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toEqual({
      from: "2026-10-10",
      to: "2026-10-16",
      groups: [
        { stationId: "KR-1-P153", direction: "up", horizonMin: 5, source: "estimated", count: 1, medianErrorSec: 30, medianAbsErrorSec: 30, p90AbsErrorSec: 30, unresolvedCount: 0 },
        { stationId: "KR-1-P153", direction: "up", horizonMin: 3, source: "estimated", count: 4, medianErrorSec: -20, medianAbsErrorSec: 20, p90AbsErrorSec: 90, unresolvedCount: 1 },
        { stationId: "KR-1-P153", direction: "up", horizonMin: 3, source: "scheduled", count: 1, medianErrorSec: 60, medianAbsErrorSec: 60, p90AbsErrorSec: 60, unresolvedCount: 0 },
        { stationId: "S1-4-420", direction: "down", horizonMin: 1, source: "live", count: 0, medianErrorSec: null, medianAbsErrorSec: null, p90AbsErrorSec: null, unresolvedCount: 2 },
      ],
    });
  });
});

describe("SubwayHistoryRepository.updateObservedArrival on mongod", () => {
  const serviceDate = "2026-10-01";
  const keyOf = { serviceDate, stationId: "KR-1-P153" };
  const records = [
    prediction({ ...keyOf, trainNo: "0692", horizonMin: 3, madeAt: at("2026-10-01T20:28:40"), predictedAt: at("2026-10-01T20:31:30") }),
    prediction({ ...keyOf, trainNo: "0692", horizonMin: 1, madeAt: at("2026-10-01T20:31:25"), predictedAt: at("2026-10-01T20:31:50") }),
    prediction({ ...keyOf, trainNo: "0692", horizonMin: 10, madeAt: at("2026-10-01T19:51:00"), predictedAt: at("2026-10-01T20:02:04") }),
  ];
  const stateOf = async (): Promise<unknown[]> =>
    db
      .getClient()
      .db(config.mongo.dbName)
      .collection<SubwayPredictionDoc>(config.subway.collections.predictions)
      .find({ serviceDate }, { projection: { _id: 0, horizonMin: 1, status: 1, observedState: 1, errorSec: 1 } })
      .sort({ horizonMin: -1 })
      .toArray();

  it("resolves by an approaching row only the records made before the tick that saw it, then by the arrived row the rest within 30 minutes", async () => {
    // Arrange
    const repository = app.get<SubwayHistoryRepository>(SubwayHistoryRepositoryClass);
    const arrival = { serviceDate, trainNo: "0692", platformId: "KR-1-P153" };
    await repository.upsertPredictions(records);

    // Act
    await repository.updateObservedArrival({ ...arrival, observedAt: at("2026-10-01T20:31:50"), observedState: "approaching" }, at("2026-10-01T20:31:25"));
    const afterApproach = await stateOf();
    await repository.updateObservedArrival({ ...arrival, observedAt: at("2026-10-01T20:32:05"), observedState: "arrived" }, at("2026-10-01T20:32:05"));

    // Assert
    expect(afterApproach).toEqual([
      { horizonMin: 10, status: "resolved", observedState: "approaching", errorSec: -1786 },
      { horizonMin: 3, status: "resolved", observedState: "approaching", errorSec: -20 },
      { horizonMin: 1, status: "open", observedState: null, errorSec: null },
    ]);
    expect(await stateOf()).toEqual([
      { horizonMin: 10, status: "resolved", observedState: "approaching", errorSec: -1786 },
      { horizonMin: 3, status: "resolved", observedState: "arrived", errorSec: -35 },
      { horizonMin: 1, status: "resolved", observedState: "arrived", errorSec: -15 },
    ]);
  });
});

describe("SubwayHistoryRepository at boot", () => {
  it("creates subway_events as a time-series collection on at, meta as its meta field, expiring after 180 days, where pollers run", async () => {
    // Arrange
    const { PollerRegistryService } = require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry };
    const registered = jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation(() => undefined);
    const pollerApp = await buildTestApp({
      imports: appModulesUnder("src/scheduling/", "src/calendar/", "src/subway/"),
      overrides: [{ provide: Clock, useValue: CLOCK }],
      role: "poller",
    });

    // Act
    let events: unknown;
    try {
      for (let attempt = 0; attempt < 50 && events === undefined; attempt++) {
        [events] = await db.getClient().db(config.mongo.dbName).listCollections({ name: "subway_events" }).toArray();
        if (events === undefined) await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      registered.mockRestore();
      await pollerApp.close();
    }

    // Assert
    expect(events).toMatchObject({
      type: "timeseries",
      options: { timeseries: { timeField: "at", metaField: "meta", granularity: "seconds" }, expireAfterSeconds: 15_552_000 },
    });
  }, APP_BOOT_TIMEOUT_MS);
});
