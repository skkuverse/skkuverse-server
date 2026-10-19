/**
 * Characterization of GET /ui/home/campus (move-editorial-datasets task 2.3,
 * design D13): the bytes, `Cache-Control`, `Vary` and `ETag` it answers in
 * `ko`, `en` and `zh` for the banners in fixtures/campus-banners.dataset.json,
 * through the production pipeline with only `Clock` overridden. The app boots
 * every module `src/app.module.ts` imports under `src/ui/campus/`, over a real
 * `mongod`.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * expected values were pinned while the banners were still a committed file,
 * of which revision 1 of the dataset, and so the fixture, is a copy; serving
 * them from the content database changed no byte here.
 *
 * The banners are stored in the real `mongod`'s content database the way
 * `npm run data` stores them: the fixture's data pushed through the tool's own
 * scripts/lib/datasets/store.js, as revision 1 of `campus-banners`.
 *
 * Every banner closes at 2026-10-03T00:00+09:00 and has no start, so two
 * clocks pin the sheet:
 * - at the production capture (2026-10-19T14:05:27Z, source commit 5c0ee5a9),
 *   every banner has closed and each body, `Vary` and weak `ETag` equals what
 *   production served;
 * - at 12:00 KST on 2026-10-01, every banner shows, and the carousel holds all
 *   28 in file order. Each banner's `alt` holds Korean only, so every language
 *   serves the Korean text.
 */
import crypto from "crypto";
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

type Lang = "ko" | "en" | "zh";

const CAPTURED_AT: Clock = { now: () => new Date("2026-10-19T14:05:27.000Z") };
const BANNERS_OPEN: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };

/** What production served at CAPTURED_AT, as captured: the body text and its weak ETag. */
const CAPTURED: Record<Lang, { text: string; etag: string }> = {
  ko: { text: '{"meta":{"lang":"ko"},"data":{"minAppVersion":"2.0.0","sections":[]}}', etag: 'W/"45-XQpBdn/pHevBVQb24NwkrrYunWE"' },
  en: { text: '{"meta":{"lang":"en"},"data":{"minAppVersion":"2.0.0","sections":[]}}', etag: 'W/"45-g2w4b3BvfiNe3B+xYqd9MUp654g"' },
  zh: { text: '{"meta":{"lang":"zh"},"data":{"minAppVersion":"2.0.0","sections":[]}}', etag: 'W/"45-duKN8nSPL2CMGWJ9pz0NlNQP8NQ"' },
};

const BANNER_IDS = Array.from({ length: 28 }, (_, i) => `eskara-2026-banner-${String(i + 1).padStart(2, "0")}`);

interface FixtureBanner {
  type: string;
  id: string;
  imageUrl: string;
  alt: Record<string, string>;
  endAt: string;
}

function fixtureBanners(): FixtureBanner[] {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/campus-banners.dataset.json"), "utf8")) as { items: FixtureBanner[] };
  return fixture.items;
}

/** The carousel fixtures/campus-banners.dataset.json holds, without its provenance note. */
function fixtureCarousel(): Record<string, unknown> {
  const carousel = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/campus-banners.dataset.json"), "utf8")) as Record<string, unknown>;
  delete carousel._about;
  return carousel;
}

/** The envelope served in `lang` while every banner shows, key order included, so its JSON text is the served bytes. */
function openSheetBody(lang: Lang): unknown {
  return {
    meta: { lang },
    data: {
      minAppVersion: "2.0.0",
      sections: [
        {
          type: "banner_carousel",
          id: "campus_banners",
          aspectRatio: 6,
          autoRotateSec: 6,
          items: fixtureBanners().map(({ id, imageUrl, alt }) => ({ type: "image", id, imageUrl, alt: alt.ko })),
        },
      ],
    },
  };
}

// QUIRK(express): the default weak ETag, W/"<length hex>-<first 27 chars of the base64 SHA-1>" of the body bytes.
function weakEtagOf(text: string): string {
  const body = Buffer.from(text, "utf8");
  const hash = crypto.createHash("sha1").update(body).digest("base64").substring(0, 27);
  return `W/"${body.length.toString(16)}-${hash}"`;
}

let mongod: TestMongod;
let db: Db;
let capturedApp: NestExpressApplication;
let openApp: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "campus-banners", fixtureCarousel(), { by: "characterization@example.com", now: CAPTURED_AT.now() });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  capturedApp = await buildTestApp({
    imports: appModulesUnder("src/ui/campus/"),
    overrides: [{ provide: Clock, useValue: CAPTURED_AT }],
    role: "api",
  });
  openApp = await buildTestApp({
    imports: appModulesUnder("src/ui/campus/"),
    overrides: [{ provide: Clock, useValue: BANNERS_OPEN }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await capturedApp?.close();
    await openApp?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

describe("GET /ui/home/campus at the production capture, every banner closed", () => {
  it.each<Lang>(["ko", "en", "zh"])("answers in %s the bytes and ETag production served, cacheable by the client alone", async (lang) => {
    // Act
    const res = await request(capturedApp.getHttpServer()).get("/ui/home/campus").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(CAPTURED[lang].text);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(CAPTURED[lang].etag);
  });
});

describe("GET /ui/home/campus on 2026-10-01, every banner open", () => {
  it("reads 28 banners, each with a Korean-only alt, closing at the end of 2026-10-02 KST", () => {
    // Act
    const banners = fixtureBanners();

    // Assert
    expect(banners.map((banner) => banner.id)).toEqual(BANNER_IDS);
    expect(banners.every((banner) => Object.keys(banner.alt).join() === "ko")).toBe(true);
    expect(new Set(banners.map((banner) => banner.endAt))).toEqual(new Set(["2026-10-03T00:00:00+09:00"]));
  });

  it.each<Lang>(["ko", "en", "zh"])("answers in %s every banner in file order with its Korean alt, cacheable by the client alone", async (lang) => {
    // Act
    const res = await request(openApp.getHttpServer()).get("/ui/home/campus").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual(openSheetBody(lang));
    expect(res.text).toBe(JSON.stringify(openSheetBody(lang)));
    expect(res.body.data.sections[0].items.map((banner: { id: string }) => banner.id)).toEqual(BANNER_IDS);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toBe("Accept-Language, Origin");
    expect(res.headers.etag).toBe(weakEtagOf(res.text));
  });
});
