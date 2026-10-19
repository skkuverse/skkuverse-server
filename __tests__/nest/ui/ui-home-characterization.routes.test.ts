/**
 * Characterization of GET /ui/home (move-runtime-data-to-db task 1.2, design
 * D10): the bytes, `Cache-Control` and `Vary` it answers in `ko`, `en` and
 * `zh` for the layout in fixtures/home-layout.dataset.json, through the
 * production pipeline with only `Clock` overridden.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). Each body
 * equals what production served on 2026-10-19 at 11:14 UTC, before the layout
 * moved to MongoDB; the move must not change a byte of it. The app boots every
 * module `src/app.module.ts` imports under `src/ui/home/`.
 *
 * The layout is stored in a real `mongod`'s content database the way
 * `npm run data` stores it: the fixture's data pushed through the tool's own
 * scripts/lib/datasets/store.js, as revision 1 of `home-layout`.
 *
 * The clock stands at 12:00 KST on 2026-10-19. The layout holds no banner
 * window, so the instant changes nothing today; it is fixed so that it never
 * does by accident.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

const CLOCK: Clock = { now: () => new Date("2026-10-19T03:00:00.000Z") };

type Lang = "ko" | "en" | "zh";

const TITLES: Record<Lang, Record<"building_map" | "building_code" | "lost_found" | "inquiry", string>> = {
  ko: { building_map: "건물지도", building_code: "건물코드", lost_found: "분실물", inquiry: "문의하기" },
  en: { building_map: "Building Map", building_code: "Building Code", lost_found: "Lost & Found", inquiry: "Inquiry" },
  zh: { building_map: "建筑地图", building_code: "建筑编号", lost_found: "失物招领", inquiry: "咨询" },
};

/** The envelope production served in `lang`, key order included, so its JSON text is the served bytes. */
function servedBody(lang: Lang): unknown {
  const titles = TITLES[lang];
  return {
    meta: { lang },
    data: {
      version: 1,
      sections: [
        { type: "banner_carousel", id: "home_top", aspectRatio: 2.25, autoRotateSec: 5, items: [{ type: "default" }] },
        {
          type: "tile_grid",
          id: "home_tiles",
          tiles: [
            {
              kind: "link",
              id: "building_map",
              title: titles.building_map,
              icon: { kind: "emoji", emoji: "🏢" },
              actionType: "route",
              actionValue: "/map/hssc",
            },
            {
              kind: "link",
              id: "building_code",
              title: titles.building_code,
              icon: { kind: "emoji", emoji: "🔢" },
              actionType: "route",
              actionValue: "/search",
            },
            {
              kind: "link",
              id: "lost_found",
              title: titles.lost_found,
              icon: { kind: "emoji", emoji: "🧳" },
              actionType: "webview",
              actionValue: "https://webview.skkuverse.com/skku/lostandfound",
            },
            {
              kind: "link",
              id: "inquiry",
              title: titles.inquiry,
              icon: { kind: "emoji", emoji: "💬" },
              actionType: "external",
              actionValue: "https://pf.kakao.com/_cjxexdG/chat",
            },
            { kind: "game", id: "subway-typing" },
            { kind: "game", id: "wave-run" },
          ],
        },
      ],
    },
  };
}

/** The layout fixtures/home-layout.dataset.json holds, without its provenance note. */
function fixtureLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/home-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

let mongod: TestMongod;
let db: Db;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "home-layout", fixtureLayout(), { by: "characterization@example.com", now: CLOCK.now() });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({
    imports: appModulesUnder("src/ui/home/"),
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

describe("GET /ui/home over the committed layout", () => {
  it.each<Lang>(["ko", "en", "zh"])("answers in %s the bytes production served, cacheable by the client alone", async (lang) => {
    // Act
    const res = await request(app.getHttpServer()).get("/ui/home").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual(servedBody(lang));
    expect(res.text).toBe(JSON.stringify(servedBody(lang)));
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
  });
});
