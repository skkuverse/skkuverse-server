/**
 * Characterization of GET /ui/home/transit (move-editorial-datasets task 2.4,
 * design D13): the bytes, `Cache-Control`, `Vary` and `ETag` it answers in
 * `ko`, `en` and `zh` for the layout in fixtures/transit-layout.dataset.json,
 * through the production pipeline with only `Clock` overridden. The app boots
 * every module `src/app.module.ts` imports under `src/ui/transit/`, over a
 * real `mongod` whose `jongro_routes` holds the three Jongno routes as
 * production stored them (fixtures/jongro-registry-routes.json of bus).
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * expected values were pinned while the layout was read from the committed
 * transit-layout.json, which the fixture equals (ui-dataset-fixtures.test.ts);
 * moving it to the content database must not change a byte here.
 *
 * The layout is stored in the real `mongod`'s content database the way
 * `npm run data` stores it: the fixture's data pushed through the tool's own
 * scripts/lib/datasets/store.js, as revision 1 of `transit-layout`.
 *
 * The bus groups' visibility windows are the only input that moves with the
 * time, so four clocks pin the tab:
 * - at the production capture (2026-10-19T14:05:27Z, source commit 5c0ee5a9)
 *   and at 10:00 KST on 2026-10-20, the commute card is open and fasttrack's
 *   week is past: each body and weak `ETag` equals what production served
 *   (fixtures/transit-production.capture.json);
 * - one second before the commute card opens (11:54:59 KST on 2026-10-12),
 *   the commute card is hidden, and with it the group of commute-stop stations
 *   that is visible with it;
 * - in fasttrack's week (12:00 KST on 2026-03-03), the fasttrack card shows
 *   after the campus shuttle's, and the commute card is hidden.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import captured from "./fixtures/transit-production.capture.json";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type BusRegistryHelpers = typeof import("../../helpers/bus/bus-registry");
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];

interface ItemBody {
  kind: string;
  id: string;
}
interface SectionBody {
  id: string;
  items: ItemBody[];
}
interface TransitBody {
  meta: { lang: Lang };
  data: { version: number; sections: SectionBody[] };
}

const CLOCKS = {
  capturedAt: new Date("2026-10-19T14:05:27.000Z"),
  commuteRunMorning: new Date("2026-10-20T01:00:00.000Z"),
  beforeCommuteOpens: new Date("2026-10-12T02:54:59.000Z"),
  fasttrackWeek: new Date("2026-03-03T03:00:00.000Z"),
};
type ClockName = keyof typeof CLOCKS;

const FASTTRACK_TEXTS: Record<Lang, { label: string; subtitle: string }> = {
  ko: { label: "패스트트랙", subtitle: "테스트 버스" },
  en: { label: "Fasttrack", subtitle: "Test Bus" },
  zh: { label: "快速通道", subtitle: "测试巴士" },
};

/** The fasttrack card in `lang`, key order included; production served none in the capture's week. */
function fasttrackItem(lang: Lang): ItemBody {
  const { label, subtitle } = FASTTRACK_TEXTS[lang];
  return {
    kind: "bus",
    id: "bus:fasttrack",
    groupId: "fasttrack",
    title: label,
    subtitle,
    icon: { type: "shuttle", color: "E65100", text: label },
    action: { actionType: "route", actionValue: "/bus/schedule?groupId=fasttrack" },
  } as ItemBody;
}

/** The layout fixtures/transit-layout.dataset.json holds, without its provenance note. */
function fixtureLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/transit-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

function capturedBody(lang: Lang): TransitBody {
  return structuredClone(captured[lang].body) as TransitBody;
}

const sectionOf = (body: TransitBody, id: string): SectionBody => body.data.sections.find((section) => section.id === id)!;

/** The captured body with the commute card and the group visible with it left out. */
function bodyBeforeCommuteOpens(lang: Lang): TransitBody {
  const body = capturedBody(lang);
  const nsc = sectionOf(body, "nsc");
  nsc.items = nsc.items.filter((item) => item.id !== "bus:commute" && item.id !== "group:commute-stations");
  return body;
}

/** The body before the commute card opens, with the fasttrack card after the campus shuttle's. */
function bodyInFasttrackWeek(lang: Lang): TransitBody {
  const body = bodyBeforeCommuteOpens(lang);
  sectionOf(body, "campus").items.push(fasttrackItem(lang));
  return body;
}

// QUIRK(express): the default weak ETag, W/"<length hex>-<first 27 chars of the base64 SHA-1>" of the body bytes.
function weakEtagOf(text: string): string {
  const body = Buffer.from(text, "utf8");
  const hash = crypto.createHash("sha1").update(body).digest("base64").substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

let mongod: TestMongod;
let db: Db;
const apps = new Map<ClockName, NestExpressApplication>();

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const { storedJongroRouteDocuments } = require("../../helpers/bus/bus-registry") as BusRegistryHelpers;
  await db
    .getClient()
    .db(config.mongo.dbName)
    .collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes)
    .insertMany(storedJongroRouteDocuments());
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "transit-layout", fixtureLayout(), { by: "characterization@example.com", now: CLOCKS.capturedAt });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  for (const [name, at] of Object.entries(CLOCKS) as Array<[ClockName, Date]>) {
    const clock: Clock = { now: () => at };
    apps.set(
      name,
      await buildTestApp({
        imports: appModulesUnder("src/ui/transit/"),
        overrides: [{ provide: Clock, useValue: clock }],
        role: "api",
      }),
    );
  }
}, APP_BOOT_TIMEOUT_MS * 4);

afterAll(async () => {
  try {
    for (const app of apps.values()) await app.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

const transitAt = (clock: ClockName, lang: Lang) =>
  request(apps.get(clock)!.getHttpServer()).get("/ui/home/transit").set("Accept-Language", lang);

describe("GET /ui/home/transit with the commute card open", () => {
  it.each(LANGS.flatMap((lang) => (["capturedAt", "commuteRunMorning"] as const).map((clock) => [lang, clock] as const)))(
    "answers in %s at %s the bytes and ETag production served, cacheable by the client alone",
    async (lang, clock) => {
      // Act
      const res = await transitAt(clock, lang);

      // Assert
      expect(res.status).toBe(captured[lang].status);
      expect(res.body).toEqual(captured[lang].body);
      expect(res.text).toBe(JSON.stringify(captured[lang].body));
      expect(res.headers["cache-control"]).toBe("private, max-age=300");
      expect(res.headers.vary).toBe("Accept-Language, Origin");
      expect(res.headers.etag).toBe(captured[lang].etag);
    },
  );
});

describe("GET /ui/home/transit before the commute card opens", () => {
  it.each(LANGS)("answers in %s without the commute card or the stations visible with it", async (lang) => {
    // Act
    const res = await transitAt("beforeCommuteOpens", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(bodyBeforeCommuteOpens(lang)));
    expect(sectionOf(res.body, "nsc").items.map((item) => item.id)).toEqual(["subway:sungkyunkwan"]);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(weakEtagOf(res.text));
  });
});

describe("GET /ui/home/transit in fasttrack's week", () => {
  it.each(LANGS)("answers in %s with the fasttrack card after the campus shuttle's", async (lang) => {
    // Act
    const res = await transitAt("fasttrackWeek", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(bodyInFasttrackWeek(lang)));
    expect(sectionOf(res.body, "campus").items.map((item) => item.id)).toEqual(["bus:campus", "bus:fasttrack"]);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(weakEtagOf(res.text));
  });
});
