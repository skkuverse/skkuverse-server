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
 * `minOsVersion` (the lowest OS that can install the store build meeting
 * `minVersion`) is appended as the last key of each platform gate, after
 * `updateUrl`, so every other key keeps its bytes and its place.
 *
 * `webview.bridgeOrigins` no longer names the standalone ESKARA site, whose
 * festival closed on 2026-10-09: that one entry is cut from the captured list
 * and the rest keep their order. `miniapps.origins` still names it.
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

/** Appended after each platform gate's `updateUrl`: the lowest OS that can install the store build meeting `minVersion`. */
const MIN_OS_VERSION_KEY = { ios: '"minOsVersion":"16.4"', android: '"minOsVersion":"24"' };

/** The captured body with the closed ESKARA 2026 site cut from `webview.bridgeOrigins`; `miniapps.origins` still names it. */
const KEPT_TEXT = CAPTURED.text.replace('"https://webview.skkuverse.com","https://eskara.miniapp.skkuverse.com",', '"https://webview.skkuverse.com",');

/** The kept body with each gate's `minOsVersion`, then `games` and `features` as the last keys of `data`, and its weak ETag. */
const SERVED = {
  text: `${KEPT_TEXT
    .replace('id6446813434"}', `id6446813434",${MIN_OS_VERSION_KEY.ios}}`)
    .replace('com.zoyoong.skkubus"}', `com.zoyoong.skkubus",${MIN_OS_VERSION_KEY.android}}`)
    .slice(0, -2)},${GAMES_KEY},${FEATURES_KEY}}}`,
  etag: 'W/"4e7-TVVzFr8RHyHSfe9vHdRdpI7/1KU"',
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
  it("answers the bytes production served with minOsVersion, games and features appended, cacheable by shared caches", async () => {
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
    const { games, features, ...captured } = res.body.data as Record<string, Record<string, unknown>>;
    expect(games).toBeDefined();
    expect(features).toBeDefined();
    for (const platform of ["ios", "android"]) {
      expect(captured[platform]!.minOsVersion).toBeDefined();
      delete captured[platform]!.minOsVersion;
    }
    expect(KEPT_TEXT).not.toBe(CAPTURED.text);
    expect(JSON.stringify({ meta: res.body.meta, data: captured })).toBe(KEPT_TEXT);
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
