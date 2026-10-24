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
 * `features` (the kill switches, skkuverse-app ADR 0023 decision 4) is appended
 * after `games` the same way, read from revision 1 of the `app-features`
 * dataset (the shared-map shell off) through an in-memory repository, on a
 * fixed clock.
 *
 * The version gates are read from the environment when src/infra/config.ts
 * loads, so the production values are set by the first import, before any
 * import reaches src/, and restored once config has loaded.
 */
import { restoreProductionGates } from "../../helpers/app-config/production-gates";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppConfigRepository } from "../../../src/app-config/app-config.repository";
import { Clock } from "../../../src/infra/clock";
import { storedAppFeaturesRepository } from "../../helpers/app-config/app-features";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { buildTestApp } from "../../helpers/nest/build-test-app";

restoreProductionGates();

/** What production served at 2026-10-19T20:12:40Z: the body text and its weak ETag. */
const CAPTURED = {
  text: '{"meta":{},"data":{"ios":{"minVersion":"3.5.0","updateUrl":"https://apps.apple.com/app/id6446813434"},"android":{"minVersion":"3.5.0","updateUrl":"https://play.google.com/store/apps/details?id=com.zoyoong.skkubus"},"webview":{"bridgeOrigins":["https://webview.skkuverse.com","https://eskara.miniapp.skkuverse.com","https://mukja.mini.skkuverse.com","https://playlist.mini.skkuverse.com","https://booth-box.mini.skkuverse.com","https://inja.mini.skkuverse.com","https://timetable.mini.skkuverse.com"]},"web":{"origin":"https://skkuverse.com"},"miniapps":{"origins":{"https://eskara.miniapp.skkuverse.com":"eskara-2026","https://mukja.mini.skkuverse.com":"mukja","https://playlist.mini.skkuverse.com":"playlist","https://booth-box.mini.skkuverse.com":"booth-box","https://inja.mini.skkuverse.com":"inja","https://timetable.mini.skkuverse.com":"timetable"}}}}',
  etag: 'W/"358-V1DWkp7H40DqGJ/5tyN+zeHk/MQ"',
};

/** The key appended to the captured body: each first-party game origin and the game that owns it. */
const GAMES_KEY =
  '"games":{"origins":{"https://apple-game.game.skkuverse.com":"apple-game","https://suika-game.game.skkuverse.com":"suika-game","https://wave-run.game.skkuverse.com":"wave-run","https://subway-typing.game.skkuverse.com":"subway-typing","https://building-stack.game.skkuverse.com":"building-stack","https://bigger-building.game.skkuverse.com":"bigger-building"}}';

/** The key appended after `games`: the kill switches as revision 1 of `app-features` stores them. */
const FEATURES_KEY = '"features":{"sharedMapShell":false}';

/** The captured body with `games`, then `features`, appended as the last keys of `data`, and its weak ETag. */
const SERVED = {
  text: `${CAPTURED.text.slice(0, -2)},${GAMES_KEY},${FEATURES_KEY}}}`,
  etag: 'W/"4e4-4gabcmGA7ZUlrsL3w7+S9mIDO+A"',
};

let app: NestExpressApplication;

beforeAll(async () => {
  app = await buildTestApp({
    imports: appModulesUnder("src/config/", "src/app-config/"),
    overrides: [
      { provide: AppConfigRepository, useValue: storedAppFeaturesRepository() },
      { provide: Clock, useValue: { now: () => new Date("2026-10-23T03:00:00.000Z") } },
    ],
    role: "api",
  });
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
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(SERVED.etag);
  });

  it("keeps every key production served byte for byte, in its place", async () => {
    // Act
    const res = await request(app.getHttpServer()).get("/app/config");

    // Assert
    const { games, features, ...captured } = res.body.data as Record<string, unknown>;
    expect(games).toBeDefined();
    expect(features).toBeDefined();
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
