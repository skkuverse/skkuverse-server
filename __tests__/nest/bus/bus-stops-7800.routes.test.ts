/**
 * The four 7800 stops proposed for `bus-stops` (fixtures/bus-stops-7800-proposal.json: the two 성균관대학교 poles,
 * which carry no ARS number, by `topisIds`, and the two 사당 poles by `arsIds`), over a real `mongod`, before any is
 * pushed. Revision 1 with them appended, stored through the tool's own scripts/lib/datasets/store.js, passes every
 * push check `npm run data -- check` runs (scripts/lib/datasets/checks.js `checkStored`, with the committed
 * timetables as the stored ones). With 7800's stations and line stored as its poller and daily sync store them and one
 * tick of its capture in `bus_cache`, the api app serves each new stop's page with 7800 on it, its direction named
 * from TOPIS's terminal, and lists the four on GET /bus/stops; 7800's other poles stay off the list and have no page.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Db as MongoDb } from "mongodb";
import request from "supertest";
import type { BusCacheDocument } from "../../../src/bus/cache/bus-cache.document";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import type { JongroRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.document";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import proposal from "./fixtures/bus-stops-7800-proposal.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const store = require("../../../scripts/lib/datasets/store");
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const { checkStored } = require("../../../scripts/lib/datasets/checks");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type BusStopsHelpers = typeof import("../../helpers/bus/bus-stops");
type BusRoutePathHelpers = typeof import("../../helpers/bus/bus-route-path");
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");
type Topis7800Helpers = typeof import("../../helpers/bus/topis-7800");
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

// 17:51:10 KST on Saturday 2026-10-24, ten seconds after the capture's rows were made.
const NOW = new Date("2026-10-24T08:51:10Z");
const STORED_BY = { by: "proposal@example.com", now: NOW };
// WHY: mongod's TTL monitor drops a bus_cache key a minute after `_updatedAt` by the wall clock; a seed dated a year
// ahead outlives the suite, and the live route's freshness reads the clock override, not `_updatedAt`.
const CACHE_UPDATED_AT = new Date(Date.now() + 365 * 24 * 60 * 60_000);
const SRC = path.join(__dirname, "../../../src");
const COMMITTED_PATTERNS = ["campus-schedule.json", "commute-schedule.json"].flatMap((file) =>
  buildDocuments(parseTimetableFile(JSON.parse(fs.readFileSync(path.join(__dirname, "../../../scripts/data", file), "utf8")))),
);

let mongod: TestMongod;
let db: Db;
let busDb: MongoDb;
let content: MongoDb;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  busDb = db.getClient().db(config.mongo.dbName);
  content = db.getClient().db(config.content.dbName);
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  const { storedJongroRoutePathDocuments } = require("../../helpers/bus/bus-route-path") as BusRoutePathHelpers;
  const { arrivalDocs7800, registryDoc7800, routePathDoc7800 } = require("../../helpers/bus/topis-7800") as Topis7800Helpers;
  await busDb.collection("bus_schedules").insertMany(COMMITTED_PATTERNS);
  await busDb.collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany([...storedJongroRouteDocuments(), registryDoc7800()]);
  await busDb.collection<JongroRoutePathDocument>(config.mongo.collections.jongroRoutePaths).insertMany([...storedJongroRoutePathDocuments(), routePathDoc7800()]);
  const cacheDocs = [
    { _id: "jongro_stations_7800", data: arrivalDocs7800(), _updatedAt: CACHE_UPDATED_AT },
    { _id: "jongro_locations_7800", data: [], _updatedAt: CACHE_UPDATED_AT },
  ];
  await busDb.collection<BusCacheDocument>(config.mongo.collections.busCache).insertMany(cacheDocs as unknown as BusCacheDocument[]);
  const { busStopsFixture } = require("../../helpers/bus/bus-stops") as BusStopsHelpers;
  const stops = busStopsFixture() as { stops: unknown[] };
  stops.stops.push(...proposal.stops);
  await store.create(content, "bus-stops", stops, STORED_BY);
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(content, "jongro-route-attributes", routeAttributesFixture(), STORED_BY);
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [{ provide: Clock, useValue: { now: () => NOW } }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await clearCollections(busDb);
    await clearCollections(content);
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

type StopPageRoute = { groupId: string; label: string; towards: string | null; direction: { id: string; label: string } | null; arrivals: unknown[] };
const pageOf = async (stopId: string) => request(app.getHttpServer()).get(`/bus/stops/${stopId}/arrivals`);

describe("the 7800 stops proposed for bus-stops", () => {
  it("pass every push check npm run data runs, against the stored timetables", async () => {
    // Arrange
    const catalog = loadCatalog((relativePath: string) => require(path.join(SRC, relativePath)));
    const readCollection = (key: string) => busDb.collection(catalog.collections[key].name).find({}, { projection: catalog.collections[key].projection }).toArray();

    // Act
    const result = await checkStored(content, catalog, ["bus-stops"], readCollection);

    // Assert
    expect(result).toEqual({ checked: [{ dataset: "bus-stops", revision: 1 }], missing: [], issues: [] });
  });

  it.each([
    ["nsc-skku-to-sadang", 23, "사당역 방면"],
    ["nsc-skku-to-suwon", 57, "호매실동차고지 방면"],
    ["sadang-exit9", 40, "호매실동차고지 방면"],
    ["sadang-median", 38, "사당역 방면"],
  ])("serves %s's page with 7800 at station %i, its direction named %s", async (stopId, stationIndex, directionLabel) => {
    // Act
    const res = await pageOf(stopId);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.stop.id).toBe(stopId);
    const routes = res.body.data.routes as StopPageRoute[];
    expect(routes.map((route) => [route.groupId, route.label, route.direction?.label])).toEqual([["gyeonggi7800", "7800", directionLabel]]);
    expect(routes[0]).toMatchObject({ stationIndex });
  });

  it("lists the four on GET /bus/stops with 7800 in station order, the two 성균관대학교 stops under nsc and the 사당 ones under none, and none of 7800's other poles", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/bus/stops");

    // Assert
    expect(res.status).toBe(200);
    const stops = res.body.data.stops as Array<{ id: string; campus: string | null; routes: Array<{ groupId: string }> }>;
    const with7800 = stops.filter((stop) => stop.routes.some((route) => route.groupId === "gyeonggi7800"));
    expect(with7800.map((stop) => [stop.id, stop.campus])).toEqual([
      ["nsc-skku-to-sadang", "nsc"],
      ["sadang-median", null],
      ["sadang-exit9", null],
      ["nsc-skku-to-suwon", "nsc"],
    ]);
    expect(stops.some((stop) => ["226000039", "120000671", "220000020"].includes(stop.id))).toBe(false);
  });

  it("answers no page for a 7800 pole no local stop aliases", async () => {
    // Act
    const res = await pageOf("226000039");

    // Assert
    expect([res.status, res.body.error.code]).toEqual([404, "BUS_STOP_NOT_FOUND"]);
  });
});
