/**
 * Characterization of the subway arrivals route over the network topology
 * (ADR 0011, D6): every platform direction's
 * name, previous and next stations in the request language, and each train's
 * stops away from the direction's upstream platforms. For every served
 * station in `ko`, `en` and `zh`, `GET /subway/stations/:id/arrivals` answers
 * the full body, status, `Cache-Control`, `Vary` and `ETag` today's code
 * answers from the committed registry file; its static fields (meta,
 * the station, each line's display data and platform id, each direction's
 * name and neighbors) are those production served on 2026-10-20
 * (fixtures/subway-arrivals-production.capture.json, source commit d856f333).
 *
 * The app boots every module `src/app.module.ts` imports under
 * `src/scheduling/` and `src/subway/`, as an api replica, through the
 * production pipeline with only `Clock` overridden, at the capture's instant.
 * It runs over a real `mongod` whose `subway_arrivals` holds one fresh
 * document per served platform (fixtures/subway-arrivals-seed.json): its
 * trains stand at the station, at upstream platforms, at no position and at
 * the next platform, so every train is served from the stored state and no
 * timetable is read; and whose content database holds revision 1 of
 * `subway-topology` and of `subway-station-coords`, stored through the tool's own
 * scripts/lib/datasets/store.js. Each station's `coords` is revision 1's, which
 * production did not serve on 2026-10-20: the expected station adds it to the capture's. The topology is the dataset's; every expected value was pinned while it was still the committed registry file, of
 * which revision 1 is a copy.
 *
 * At 00:20 and 02:00 KST on Wednesday 2026-10-21, the night window production
 * is captured in, the same seed is 14 h old, so every station answers from the
 * timetables alone: the status, `Cache-Control`, `Vary`, `ETag` and bytes the
 * code answered from the committed timetables before the topology reader landed
 * (fixtures/subway-arrivals-night.golden.json, generated at commit 46c6ea60).
 * The timetables are revision 1 of `subway-timetables`, the trimmed fixture
 * stored through scripts/lib/datasets/parts.js.
 *
 * A regression pin: a failure is a regression to report, and an expected
 * value changes only with the behavior it pins (`.claude/rules/tests.md`).
 */
import crypto from "crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../../../src/subway/subway.document";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import captured from "./fixtures/subway-arrivals-production.capture.json";
import night from "./fixtures/subway-arrivals-night.golden.json";
import seeded from "./fixtures/subway-arrivals-seed.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type TopologyHelpers = typeof import("../../helpers/subway/topology");
type TimetableHelpers = typeof import("../../helpers/subway/timetables");
type StationCoordsHelpers = typeof import("../../helpers/subway/station-coords");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];
const STATION_IDS = ["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang"] as const;
type StationId = (typeof STATION_IDS)[number];

const NOW = new Date(captured.capturedAt);
const SERVER_NOW = "2026-10-20T10:12:46+09:00";
let clockAt = NOW;
const CLOCK: Clock = { now: () => new Date(clockAt) };
const VARY = "Accept-Language, Origin";

// The stops away of each seeded train (ADR 0022, D2), in its direction's order: up standing at the station (0),
// leaving its first upstream platform (1) and approaching its last (its upstream count plus one); down standing at
// its second upstream platform (2), at no position and at its next platform, which is no upstream platform (null).
const STOPS_AWAY: Record<string, { up: Array<number | null>; down: Array<number | null> }> = {
  "KR-1-0153": { up: [0, 1, 4], down: [2, null, null] },
  "S1-4-420": { up: [0, 1, 4], down: [2, null, null] },
  "DX-D1-4312": { up: [0, 1, 4], down: [2, null, null] },
  "KR-K1-K230": { up: [0, 1, 4], down: [2, null, null] },
  "S1-2-216": { up: [0, 1, 4], down: [2, null, null] },
  "S1-8-2815": { up: [0, 1, 4], down: [2, null, null] },
  "S1-3-334": { up: [0, 1, 4], down: [2, null, null] },
  "KR-K1-K217": { up: [0, 1, 4], down: [2, null, null] },
  "S1-2-222": { up: [0, 1, 4], down: [2, null, null] },
  "DX-D1-4307": { up: [0, 1, 4], down: [2, null, null] },
  "S1-3-332": { up: [0, 1, 4], down: [2, null, null] },
  "DX-D1-4308": { up: [0, 1, 4], down: [2, null, null] },
  "DX-D1-4318": { up: [0, 1, 2], down: [2, null, null] },
};
// The status of each seeded train, in the same order, by the table of docs/reference/subway-api.md ("Call status").
const STATUSES = { up: ["arriving", "enRoute", "enRoute"], down: ["enRoute", "scheduled", "unknown"] } as const;
const BASES = { live: "provider", estimated: "estimate", scheduled: "timetable" } as const;
const atKst = (iso: string): string => `${new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 19)}+09:00`;

type SeededDoc = (typeof seeded.docs)[number];
type CapturedStation = (typeof captured.stations)[StationId]["ko"];

const seededDocOf = (platformId: string): SeededDoc => seeded.docs.find((doc) => doc._id === platformId)!;

/**
 * The body: the capture's static fields, and each seeded train with its pinned stops away. Production served no
 * `meta.serverNow` or `isFirstTrain` on 2026-10-20: the expected meta adds the clock at +09:00 to the capture's, and
 * each train its seeded `isFirstTrain` (app ADR 0022, D4). Changed 2026-10-25 with the behavior it pins (ADR 0022,
 * D2, D3): each train is the call plus its trainNo, its stops away counted per C4, its status by its position; the
 * seed stores none of the timetable pair or isLastRun, so they serve null, and a scheduled train's time is its
 * scheduled arrival; generatedAt and every instant are at +09:00 to the second.
 */
function expectedBody(stationId: StationId, lang: Lang) {
  const capture: CapturedStation = captured.stations[stationId][lang];
  return {
    meta: { ...capture.meta, serverNow: SERVER_NOW },
    data: {
      station: { ...capture.station, coords: stationCoordsFixture().stations[stationId] },
      lines: capture.lines.map(({ line, platformId, directions }) => {
        const doc = seededDocOf(platformId);
        return {
          line,
          platformId,
          generatedAt: atKst(doc.generatedAt),
          directions: directions.map(({ direction, name, previousStation, nextStation }) => {
            const key = direction as "up" | "down";
            const trains = doc.directions[key].map(({ trainNo, destination, express, arrivalAt, source, isFirstTrain }, i) => {
              const basis = BASES[source as keyof typeof BASES];
              return {
                status: STATUSES[key][i],
                expectedArrivalAt: basis === "timetable" ? null : atKst(arrivalAt),
                expectedDepartureAt: null,
                scheduledArrivalAt: basis === "timetable" ? atKst(arrivalAt) : null,
                scheduledDepartureAt: null,
                basis,
                stopsAway: STOPS_AWAY[platformId]![key][i],
                runId: `${line.code}/${doc.serviceDate}/${trainNo}`,
                vehicleId: null,
                headsign: destination,
                isFirstRun: isFirstTrain,
                isLastRun: null,
                isExpress: express,
                providerText: null,
                trainNo,
              };
            });
            return { direction, name, previousStation, nextStation, trains };
          }),
        };
      }),
    },
  };
}

// QUIRK(express): the default weak ETag, W/"<length hex>-<first 27 chars of the base64 SHA-1>" of the body bytes.
function weakEtagOf(text: string): string {
  const body = Buffer.from(text, "utf8");
  const hash = crypto.createHash("sha1").update(body).digest("base64").substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

type SeededTrain = Omit<StoredTrainArrival, "arrivalAt"> & { arrivalAt: string };

function toStoredDoc({ _id, generatedAt, serviceDate, directions }: SeededDoc): SubwayArrivalsDoc {
  // WHY: JSON gives `source` and `state` as plain strings; the seed holds only the stored values.
  const toTrains = (trains: readonly unknown[]) => (trains as SeededTrain[]).map((train) => ({ ...train, arrivalAt: new Date(train.arrivalAt) }));
  return { _id, generatedAt: new Date(generatedAt), serviceDate, directions: { up: toTrains(directions.up), down: toTrains(directions.down) } };
}

let mongod: TestMongod;
let stationCoordsFixture: StationCoordsHelpers["stationCoordsFixture"];
let db: Db;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const subwayDb = db.getClient().db(config.mongo.dbName);
  await subwayDb.collection<SubwayArrivalsDoc>(config.subway.collections.arrivals).insertMany(seeded.docs.map(toStoredDoc));
  const { subwayTopologyFixture } = require("../../helpers/subway/topology") as TopologyHelpers;
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "subway-topology", subwayTopologyFixture(), { by: "characterization@example.com", now: NOW });
  ({ stationCoordsFixture } = require("../../helpers/subway/station-coords") as StationCoordsHelpers);
  await store.create(content, "subway-station-coords", stationCoordsFixture(), { by: "characterization@example.com", now: NOW });
  const { storeSubwayTimetablesFixture } = require("../../helpers/subway/timetables") as TimetableHelpers;
  await storeSubwayTimetablesFixture(content, { by: "characterization@example.com", now: NOW });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/subway/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

describe("GET /subway/stations/:stationId/arrivals", () => {
  it.each(LANGS.flatMap((lang) => STATION_IDS.map((stationId) => [lang, stationId] as const)))(
    "answers in %s for %s the static fields production served and every seeded train with its stops away",
    async (lang, stationId) => {
      // Arrange
      const expected = expectedBody(stationId, lang);

      // Act
      const res = await request(app.getHttpServer()).get(`/subway/stations/${stationId}/arrivals`).set("Accept-Language", lang);

      // Assert
      expect(res.status).toBe(captured.stations[stationId][lang].status);
      expect(res.body).toEqual(expected);
      expect(res.text).toBe(JSON.stringify(expected));
      expect(res.headers["cache-control"]).toBe(captured.stations[stationId][lang].cacheControl);
      expect(res.headers.vary).toBe(VARY);
      expect(res.headers.etag).toBe(weakEtagOf(JSON.stringify(expected)));
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    },
  );
});

type NightAnswer = { status: number; cacheControl: string; vary: string; etag: string; body: unknown };
const NIGHT_INSTANTS = Object.keys(night.instants) as Array<keyof typeof night.instants>;

describe.each(NIGHT_INSTANTS)("GET /subway/stations/:stationId/arrivals at %s, timetable only", (instant) => {
  beforeAll(() => {
    clockAt = new Date(instant);
  });

  afterAll(() => {
    clockAt = NOW;
  });

  it.each(LANGS.flatMap((lang) => STATION_IDS.map((stationId) => [lang, stationId] as const)))(
    "answers in %s for %s the bytes and headers the code answered before the topology reader",
    async (lang, stationId) => {
      // Arrange
      const expected = (night.instants[instant] as Record<StationId, Record<Lang, NightAnswer>>)[stationId][lang];

      // Act
      const res = await request(app.getHttpServer()).get(`/subway/stations/${stationId}/arrivals`).set("Accept-Language", lang);

      // Assert
      expect(res.status).toBe(expected.status);
      expect(res.body).toEqual(expected.body);
      expect(res.text).toBe(JSON.stringify(expected.body));
      expect(res.headers["cache-control"]).toBe(expected.cacheControl);
      expect(res.headers.vary).toBe(expected.vary);
      expect(res.headers.etag).toBe(expected.etag);
    },
  );
});
