/**
 * GET /miniapps and GET /miniapps/:id through the production pipeline
 * (buildTestApp): the real catalog controller, service and registry, over a
 * manifest client that answers no shell fields and the notification fakes.
 *
 * These endpoints are the SSOT the mobile client replaced its bundled registry
 * with, so the guards that matter are: the index is ordered, image logo URIs are
 * absolute under WEB_ORIGIN or MEDIA_ORIGIN (never a bare path — the client renders them
 * directly into <Image source={{uri}}>), every index id resolves to a detail,
 * and an unknown slug 404s rather than 200-ing with null.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { MEDIA_ORIGIN, WEB_ORIGIN } from "../../../src/infra/origins";
import { Clock } from "../../../src/infra/clock";
import { ConfigModule } from "../../../src/config/config.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { MiniappsModule } from "../../../src/miniapps/miniapps.module";
import { MiniappsCatalogClient } from "../../../src/miniapps/catalog/miniapps-catalog.client";
import { MiniappsCatalogModule } from "../../../src/miniapps/catalog/miniapps-catalog.module";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { MiniappsNotificationsClient } from "../../../src/miniapps/notifications/miniapps-notifications.client";
import { MiniappsNotificationsModule } from "../../../src/miniapps/notifications/miniapps-notifications.module";
import { MiniappsNotificationsRepository } from "../../../src/miniapps/notifications/miniapps-notifications.repository";
import { FakeMiniappsCatalogClient } from "../../helpers/fakes/miniapps/miniapps-catalog.client.fake";
import { FakeMiniappsManifestClient } from "../../helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { FakeMiniappsNotificationsClient } from "../../helpers/fakes/miniapps/miniapps-notifications.client.fake";
import { FakeMiniappsNotificationsRepository } from "../../helpers/fakes/miniapps/miniapps-notifications.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { miniAppIndex } from "../../../src/miniapps/catalog/miniapps-catalog.wire";
import { miniAppDetail } from "../../../src/miniapps/miniapps.wire";

let app: NestExpressApplication;
let httpServer: import("http").Server;

// WHY: one fixed instant, so nothing these routes answer depends on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

beforeAll(async () => {
  // The manifest client answers no shell fields, as a first-party mini app
  // whose origin is unreachable does: every mini app keeps its registry shell.
  app = await buildTestApp({
    imports: [ConfigModule, SchedulingModule, MiniappsModule, MiniappsNotificationsModule, MiniappsCatalogModule],
    overrides: [
      { provide: MiniappsCatalogClient, useValue: new FakeMiniappsCatalogClient() },
      { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
      { provide: MiniappsManifestRepository, useValue: new FakeMiniappsManifestRepository() },
      { provide: MiniappsNotificationsRepository, useValue: new FakeMiniappsNotificationsRepository() },
      { provide: MiniappsNotificationsClient, useValue: new FakeMiniappsNotificationsClient() },
      { provide: Clock, useValue: CLOCK },
    ],
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /miniapps", () => {
  it("returns { version, miniApps } in the standard envelope", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");

    // Act & Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({});
    expect(typeof res.body.data.version).toBe("number");
    expect(Array.isArray(res.body.data.miniApps)).toBe(true);
    expect(res.body.data.miniApps.length).toBeGreaterThan(0);
  });

  it("is cacheable by clients and shared caches: static, language-independent", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");

    // Act & Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("orders entries by `order` ascending", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");
    const orders = res.body.data.miniApps.map(
      (m: { order: number }) => m.order,
    );

    // Act & Assert
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("resolves both logos of every entry, image logos to an absolute URL", async () => {
    // Act & Assert
    const res = await request(httpServer).get("/miniapps");
    for (const entry of res.body.data.miniApps) {
      // The single `logo` is gone; both slots are always present on the wire.
      expect(entry).not.toHaveProperty("logo");
      for (const logo of [entry.homeLogo, entry.shellLogo]) {
        // The raw on-disk `path`/`url` must not leak — the client reads `uri` or `emoji`.
        expect(logo).not.toHaveProperty("path");
        expect(logo).not.toHaveProperty("url");
        if (logo.kind === "emoji") {
          expect(logo.emoji.length).toBeGreaterThan(0);
          expect(logo).not.toHaveProperty("uri");
          continue;
        }
        // Both on-disk image spellings leave as one wire shape.
        expect(logo.kind).toBe("remote");
        expect(
          logo.uri.startsWith(`${WEB_ORIGIN}/`) || logo.uri.startsWith(`${MEDIA_ORIGIN}/`),
        ).toBe(true);
      }
    }
  });

  it("lets the grid tile and the shell logo differ (ESKARA: 📖 tile, poster in the shell)", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");
    const eskara = res.body.data.miniApps.find((m: { id: string }) => m.id === "eskara-2026");

    // Act & Assert
    expect(eskara.homeLogo).toEqual({ kind: "emoji", emoji: "📖" });
    expect(eskara.shellLogo.kind).toBe("remote");
    expect(eskara.shellLogo.uri.startsWith(`${MEDIA_ORIGIN}/`)).toBe(true);
  });

  it("fills an unset logo from the other one", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");
    const hssc = res.body.data.miniApps.find((m: { id: string }) => m.id === "hssc");

    // Act & Assert
    expect(hssc.shellLogo).toEqual(hssc.homeLogo);
  });

  it("keeps hidden entries in the index, flagged, so deep links still resolve them", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");
    const hidden = res.body.data.miniApps
      .filter((m: { hidden?: boolean }) => m.hidden === true)
      .map((m: { id: string }) => m.id);

    // Act & Assert
    expect(hidden).toEqual([
      "eskara-2026",
      "inja",
      "timetable",
      "playlist",
      "mukja",
      "booth-box",
      "hssc",
      "nsc",
      "skkuw",
      "skkuzine",
    ]);
    for (const entry of res.body.data.miniApps) {
      if ("hidden" in entry) expect(typeof entry.hidden).toBe("boolean");
    }
    // Hidden from the grid is not gone: the detail still answers.
    const detail = await request(httpServer).get("/miniapps/hssc");
    expect(detail.status).toBe(200);
  });

  it("serves an emoji logo as the emoji, for the client to draw in Tossface", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");
    const mukja = res.body.data.miniApps.find((m: { id: string }) => m.id === "mukja");

    // Act & Assert
    // Only homeLogo is authored for mukja; the shell takes the same emoji.
    expect(mukja.homeLogo).toEqual({ kind: "emoji", emoji: "😋" });
    expect(mukja.shellLogo).toEqual({ kind: "emoji", emoji: "😋" });
  });

  it("gives every entry a slug id and a display name", async () => {
    // Act & Assert
    const res = await request(httpServer).get("/miniapps");
    for (const entry of res.body.data.miniApps) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("requires no auth (succeeds without a Bearer token)", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps");

    // Act & Assert
    expect(res.status).toBe(200);
  });
});

describe("GET /miniapps/:id", () => {
  it("resolves a detail for every id in the index", async () => {
    // Act & Assert
    const index = await request(httpServer).get("/miniapps");
    for (const entry of index.body.data.miniApps) {
      const res = await request(httpServer).get(`/miniapps/${entry.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(entry.id);
      expect(res.body.data.startUrl).toMatch(/^https?:\/\//);
      expect(typeof res.body.data.verified).toBe("boolean");
      expect(Array.isArray(res.body.data.relatedLinks)).toBe(true);
      // Always the complete merged config now — never sparse, never absent.
      const shell = res.body.data.shell;
      expect(Object.keys(shell).sort()).toEqual(["background", "bar", "header", "statusBar"]);
      expect(["top", "bottom", "none"]).toContain(shell.bar);
      expect(["opaque", "overlay"]).toContain(shell.header);
      expect(["dark", "light"]).toContain(shell.statusBar);
      expect(shell.background).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("serves DEFAULT_SHELL for a first-party app whose manifest has never loaded (mocked offline)", async () => {
    // Act & Assert
    // A first-party detail carries no shell of its own (register-a-miniapp.md
    // §2): its manifest is the one source. With the origin unreachable the page
    // is too, so what the shell looks like around it no longer matters.
    for (const id of ["eskara-2026", "mukja", "playlist", "booth-box", "inja"]) {
      const res = await request(httpServer).get(`/miniapps/${id}`);
      expect(res.body.data.shell).toEqual({
        bar: "bottom",
        header: "opaque",
        statusBar: "dark",
        background: "#FFFFFF",
      });
    }
  });

  it("marks a found detail cacheable", async () => {
    // Arrange
    const index = await request(httpServer).get("/miniapps");
    const id = index.body.data.miniApps[0].id;
    const res = await request(httpServer).get(`/miniapps/${id}`);

    // Act & Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("404s on an unknown slug rather than returning null", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps/does-not-exist");

    // Act & Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MINIAPP_NOT_FOUND");
    // A slug that ships in a later deploy must not stay a cached 404.
    expect(res.headers["cache-control"] ?? "").not.toMatch(/public/);
  });

  it("404s on a path-traversal-shaped slug", async () => {
    // Arrange
    // The loader reads details/<id>.json off disk at boot, never per-request,
    // so a traversal slug can only miss the Map — but assert it, because that
    // guarantee lives in the loader's design and not in the route.
    const res = await request(httpServer).get("/miniapps/..%2F..%2Fpackage");

    // Act & Assert
    expect(res.status).toBe(404);
  });
});

describe("GET /miniapps and GET /miniapps/:id wire", () => {
  it("serves the published index shape", async () => {
    // Act
    const res = await request(httpServer).get("/miniapps");

    // Assert
    expectWire(miniAppIndex, res.body.data);
  });

  it("serves the published detail shape for every registered mini app", async () => {
    // Arrange
    const index = await request(httpServer).get("/miniapps");

    // Act
    const details = await Promise.all(index.body.data.miniApps.map((entry: { id: string }) => request(httpServer).get(`/miniapps/${entry.id}`)));

    // Assert
    for (const res of details) expectWire(miniAppDetail, res.body.data);
  });
});
