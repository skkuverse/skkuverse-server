/**
 * Characterization of GET /app/config (ADR 0011, D6): the bytes, `Cache-Control`, `Vary` and `ETag` it
 * answers, through the production pipeline, every module `src/app.module.ts`
 * imports under `src/app-config/` booted.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The body
 * and its weak ETag equal what production served at 2026-10-19T20:12:40Z,
 * commit cd9484d9, while `miniapps.origins` was still derived from the
 * committed mini app registry; the move of the origin owners into
 * `src/infra/origins.ts` must not change a byte of it.
 *
 * `games.origins` (skkuverse-app add-game-factory task 2.3, design D2) is the
 * one key served since: the body is the captured bytes with it appended, so
 * every key production served keeps its bytes and its place, and the weak ETag
 * is the appended body's.
 *
 * The version gates are read from the environment when src/infra/config.ts
 * loads, so the production values are set before anything loads it and
 * restored once it has.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { appModulesUnder } from "../../helpers/nest/app-modules";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];

/** The version gates production's Doppler config held at the capture. */
const PRODUCTION_GATES: Readonly<Record<string, string>> = {
  APP_IOS_MIN_VERSION: "3.5.0",
  APP_IOS_UPDATE_URL: "https://apps.apple.com/app/id6446813434",
  APP_ANDROID_MIN_VERSION: "3.5.0",
  APP_ANDROID_UPDATE_URL: "https://play.google.com/store/apps/details?id=com.zoyoong.skkubus",
};

/** What production served at 2026-10-19T20:12:40Z: the body text and its weak ETag. */
const CAPTURED = {
  text: '{"meta":{},"data":{"ios":{"minVersion":"3.5.0","updateUrl":"https://apps.apple.com/app/id6446813434"},"android":{"minVersion":"3.5.0","updateUrl":"https://play.google.com/store/apps/details?id=com.zoyoong.skkubus"},"webview":{"bridgeOrigins":["https://webview.skkuverse.com","https://eskara.miniapp.skkuverse.com","https://mukja.mini.skkuverse.com","https://playlist.mini.skkuverse.com","https://booth-box.mini.skkuverse.com","https://inja.mini.skkuverse.com","https://timetable.mini.skkuverse.com"]},"web":{"origin":"https://skkuverse.com"},"miniapps":{"origins":{"https://eskara.miniapp.skkuverse.com":"eskara-2026","https://mukja.mini.skkuverse.com":"mukja","https://playlist.mini.skkuverse.com":"playlist","https://booth-box.mini.skkuverse.com":"booth-box","https://inja.mini.skkuverse.com":"inja","https://timetable.mini.skkuverse.com":"timetable"}}}}',
  etag: 'W/"358-V1DWkp7H40DqGJ/5tyN+zeHk/MQ"',
};

/** The key appended to the captured body: each first-party game origin and the game that owns it. */
const GAMES_KEY =
  '"games":{"origins":{"https://apple-game.game.skkuverse.com":"apple-game","https://suika-game.game.skkuverse.com":"suika-game","https://wave-run.game.skkuverse.com":"wave-run","https://subway-typing.game.skkuverse.com":"subway-typing"}}';

/** The captured body with `games` appended as the last key of `data`, and its weak ETag. */
const SERVED = {
  text: `${CAPTURED.text.slice(0, -2)},${GAMES_KEY}}}`,
  etag: 'W/"444-eOL1wRWGvxbyBKTlMw9gEm9agBs"',
};

let app: NestExpressApplication;

beforeAll(async () => {
  const saved = Object.fromEntries(Object.keys(PRODUCTION_GATES).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, PRODUCTION_GATES);
    require("../../../src/infra/config");
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({ imports: appModulesUnder("src/config/", "src/app-config/"), role: "api" });
});

afterAll(async () => {
  await app?.close();
});

describe("GET /app/config at the production capture", () => {
  it("answers the bytes production served with games appended, cacheable by shared caches", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/app/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(SERVED.text);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(SERVED.etag);
  });

  it("keeps every key production served byte for byte, in its place", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/app/config");

    // Assert
    const { games, ...captured } = res.body.data as Record<string, unknown>;
    expect(games).toBeDefined();
    expect(JSON.stringify({ meta: res.body.meta, data: captured })).toBe(CAPTURED.text);
  });

  it("answers the same bytes in every language", async () => {
    // Act
    const en = await request(app.getHttpServer()).get("/app/config").set("Accept-Language", "en");
    const zh = await request(app.getHttpServer()).get("/app/config").set("Accept-Language", "zh");

    // Assert
    expect(en.text).toBe(SERVED.text);
    expect(zh.headers.etag).toBe(SERVED.etag);
  });
});
