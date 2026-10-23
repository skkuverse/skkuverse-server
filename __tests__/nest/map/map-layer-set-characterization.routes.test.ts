/**
 * Characterization of GET /map/config, GET /map/overlays/event and GET
 * /map/overlays/event/details (ADR 0011, D6):
 * the bytes, `Cache-Control`, `Vary` and weak `ETag` each answers for the
 * eskara-2026 layer set, through the production pipeline with only `Clock`
 * overridden. The app boots the modules `src/app.module.ts` imports under
 * `src/map/layer-set/` and the three flows that read it (`config/`, `event/`,
 * `event-details/`), over a real `mongod`.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * expected values were pinned while the layer set was read from a committed
 * file, of which fixtures/map-layer-sets.dataset.json, revision 1 of the
 * stored dataset, is a copy; moving it to the content database changed no
 * byte here.
 *
 * The layer set is stored in the real `mongod`'s content database the way
 * `npm run data` stores it: the fixture's data pushed through the tool's own
 * scripts/lib/datasets/store.js, as revision 1 of `map-layer-sets`. The mini
 * app registry is stored beside it the same way, as revision 1 of `miniapps`
 * (__tests__/nest/miniapps/fixtures/miniapps.dataset.json), which the
 * festival's `miniapp` buttons are checked against.
 *
 * The eventmap database holds what its scripts write: the 77 places of
 * scripts/data/eskara-2026-places.json, parsed by the importer's parseSheet
 * (scripts/import-eventmap-places.js) against the stored registry and written
 * by scripts/lib/eventmap-db.js, the eskara-2026 activation open
 * from 00:00 KST on 2026-10-01 to 06:00 KST on 2026-10-03, and an activation
 * for `spring-2027`, a layer set the server does not have, open in March 2027.
 * `/map/config` names the Naver map style, so the test serves production's
 * (`NAVER_MAP_STYLE_ID`, restored after). Three clocks pin the routes:
 * - at the production capture (2026-10-19T15:30:49Z, source commit 5c0ee5a9),
 *   no activation is live: each body and ETag equals what production served
 *   (fixtures/map-production.capture.json), the base map only;
 * - at 21:00 KST on 2026-10-01, inside the eskara-2026 window: the festival's
 *   layers and chips, its 77 overlays and 59 sheets
 *   (fixtures/map-festival.expected.json, what today's code answered, since no
 *   festival was live to capture);
 * - at 12:00 KST on 2027-03-05, the spring-2027 activation is live but names
 *   no layer set: the base map, as at the capture.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import captured from "./fixtures/map-production.capture.json";
import festival from "./fixtures/map-festival.expected.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");
const { parseSheet } = require("../../../scripts/import-eventmap-places");
const { enableActivation, ensureActivation, upsertPlaces } = require("../../../scripts/lib/eventmap-db");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];

const CLOCKS = {
  capturedAt: new Date("2026-10-19T15:30:49.000Z"),
  festivalNight: new Date("2026-10-01T12:00:00.000Z"),
  unknownSetLive: new Date("2027-03-05T03:00:00.000Z"),
};
type ClockName = keyof typeof CLOCKS;

const IMPORTED_AT = new Date("2026-09-30T00:00:00.000Z");
const ESKARA_WINDOW = { from: new Date("2026-09-30T15:00:00.000Z"), until: new Date("2026-10-02T21:00:00.000Z") };
const SPRING_WINDOW = { from: new Date("2027-03-01T15:00:00.000Z"), until: new Date("2027-03-09T15:00:00.000Z") };

/** What today's code answered inside the eskara-2026 window, by its weak ETag: the bytes of each expected body. */
const FESTIVAL_ETAGS = {
  config: { ko: 'W/"240c-rjUyjpFUm6Fpiv5ph54qoHghYFI"', en: 'W/"23de-RP4aVODvRQoU7Ri34SmSBW4uGb4"', zh: 'W/"2410-36YXwr7ZxYK8LVD0MgmCi/OAcrk"' },
  event: 'W/"c727-fVwEys0vAIoqll7o4lBJnn9FoaI"',
  details: 'W/"f425-ALDI+OyhS/VW9shLUW9kAgaizGE"',
};

interface Expected {
  status: number;
  body: unknown;
  etag: string;
}

const PRODUCTION_STYLE_ID = captured.config.ko.body.data.naver.styleId;

/** The layer sets fixtures/map-layer-sets.dataset.json holds, without its provenance note. */
function fixtureLayerSets(): Record<string, unknown> {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/map-layer-sets.dataset.json"), "utf8")) as Record<string, unknown>;
  delete dataset._about;
  return dataset;
}
const EVENT_CACHE_CONTROL = "public, max-age=60";
const VARY = "Accept-Language, Origin";

let mongod: TestMongod;
let db: Db;
let savedStyleId: string | undefined;
const apps = new Map<ClockName, NestExpressApplication>();

function serverAt(clock: ClockName): import("http").Server {
  return apps.get(clock)!.getHttpServer();
}

beforeAll(async () => {
  savedStyleId = process.env.NAVER_MAP_STYLE_ID;
  process.env.NAVER_MAP_STYLE_ID = PRODUCTION_STYLE_ID;
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const eventmap = db.getClient().db(config.eventmap.dbName);
  const content = db.getClient().db(config.content.dbName);
  const { fixtureRegistry } = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
  await store.create(content, "miniapps", fixtureRegistry(), { by: "characterization@example.com", now: IMPORTED_AT });
  const placesFile = fs.readFileSync(path.join(__dirname, "../../../scripts/data/eskara-2026-places.json"), "utf8");
  const { docs, errors } = await parseSheet(placesFile, { layerSetId: "eskara-2026", contentDb: content });
  expect(errors).toEqual([]);
  await upsertPlaces(eventmap.collection("places"), docs, IMPORTED_AT);
  await ensureActivation(eventmap.collection("activations"), "eskara-2026", IMPORTED_AT);
  await enableActivation(eventmap.collection("activations"), "eskara-2026", IMPORTED_AT, ESKARA_WINDOW.from, ESKARA_WINDOW.until);
  await enableActivation(eventmap.collection("activations"), "spring-2027", IMPORTED_AT, SPRING_WINDOW.from, SPRING_WINDOW.until);
  await store.create(content, "map-layer-sets", fixtureLayerSets(), { by: "characterization@example.com", now: IMPORTED_AT });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  for (const [name, at] of Object.entries(CLOCKS) as Array<[ClockName, Date]>) {
    const clock: Clock = { now: () => at };
    apps.set(
      name,
      await buildTestApp({
        imports: appModulesUnder("src/map/layer-set/", "src/map/config/", "src/map/event/", "src/map/event-details/"),
        overrides: [{ provide: Clock, useValue: clock }],
        role: "api",
      }),
    );
  }
}, APP_BOOT_TIMEOUT_MS * 3);

afterAll(async () => {
  try {
    for (const app of apps.values()) await app.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
    if (savedStyleId === undefined) delete process.env.NAVER_MAP_STYLE_ID;
    else process.env.NAVER_MAP_STYLE_ID = savedStyleId;
  }
});

/** Asserts an answer is the expected bytes: the body text, its weak ETag and the shared headers. */
function expectAnswer(res: request.Response, expected: Expected, cacheControl: string | undefined): void {
  expect(res.status).toBe(expected.status);
  expect(res.body).toEqual(expected.body);
  expect(res.text).toBe(JSON.stringify(expected.body));
  expect(res.headers.etag).toBe(expected.etag);
  expect(res.headers["cache-control"]).toBe(cacheControl);
  expect(res.headers.vary).toBe(VARY);
  expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
}

describe("the map routes at the production capture, no activation live", () => {
  it.each(LANGS)("answer /map/config in %s with the base map production served, uncached", async (lang) => {
    // Act
    const res = await request(serverAt("capturedAt")).get("/map/config").set("Accept-Language", lang);

    // Assert
    expectAnswer(res, captured.config[lang], undefined);
  });

  it("answer /map/overlays/event with no overlay, as production served, for a minute", async () => {
    // Act
    const res = await request(serverAt("capturedAt")).get("/map/overlays/event");

    // Assert
    expectAnswer(res, captured.event, EVENT_CACHE_CONTROL);
  });

  it("answer /map/overlays/event/details with no sheet, as production served, for a minute", async () => {
    // Act
    const res = await request(serverAt("capturedAt")).get("/map/overlays/event/details");

    // Assert
    expectAnswer(res, captured.details, EVENT_CACHE_CONTROL);
  });
});

describe("the map routes inside the eskara-2026 window", () => {
  it.each(LANGS)("answer /map/config in %s with the festival's layers and chips after the base map's", async (lang) => {
    // Act
    const res = await request(serverAt("festivalNight")).get("/map/config").set("Accept-Language", lang);

    // Assert
    expectAnswer(res, { ...festival.config[lang], etag: FESTIVAL_ETAGS.config[lang] }, undefined);
  });

  it("answer /map/overlays/event with the 77 imported places as overlays, for a minute", async () => {
    // Act
    const res = await request(serverAt("festivalNight")).get("/map/overlays/event");

    // Assert
    expectAnswer(res, { ...festival.event, etag: FESTIVAL_ETAGS.event }, EVENT_CACHE_CONTROL);
    expect(res.body.data.overlays).toHaveLength(77);
  });

  it("answer /map/overlays/event/details with each place's sheet by place id, for a minute", async () => {
    // Act
    const res = await request(serverAt("festivalNight")).get("/map/overlays/event/details");

    // Assert
    expectAnswer(res, { ...festival.details, etag: FESTIVAL_ETAGS.details }, EVENT_CACHE_CONTROL);
    expect(Object.keys(res.body.data.details)).toHaveLength(59);
  });
});

describe("the map routes with a live activation naming a layer set the server does not have", () => {
  it.each(LANGS)("answer /map/config in %s with the base map, as at the capture", async (lang) => {
    // Act
    const res = await request(serverAt("unknownSetLive")).get("/map/config").set("Accept-Language", lang);

    // Assert
    expectAnswer(res, captured.config[lang], undefined);
  });

  it("answer /map/overlays/event with no overlay, as at the capture", async () => {
    // Act
    const res = await request(serverAt("unknownSetLive")).get("/map/overlays/event");

    // Assert
    expectAnswer(res, captured.event, EVENT_CACHE_CONTROL);
  });

  it("answer /map/overlays/event/details with no sheet, as at the capture", async () => {
    // Act
    const res = await request(serverAt("unknownSetLive")).get("/map/overlays/event/details");

    // Assert
    expectAnswer(res, captured.details, EVENT_CACHE_CONTROL);
  });
});
