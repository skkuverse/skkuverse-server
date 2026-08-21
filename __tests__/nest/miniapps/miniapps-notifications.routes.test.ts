/**
 * The public mini-app feed, GET /miniapps/:id/notifications: unauthenticated by design (the feed carries no user
 * dimension at all), so what is worth pinning is that it stays declared ahead of GET /miniapps/:id and is not
 * swallowed by it, that an unknown slug is 404, its Cache-Control, and its wire shape. The signed send and history
 * routes are miniapps-push.routes.test.ts.
 *
 * Through the production pipeline (buildTestApp), over the sent_notifications fake, spied on so each test sees what
 * was read.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { ConfigModule } from "../../../src/config/config.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { MiniappsModule } from "../../../src/miniapps/miniapps.module";
import { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { MiniappsCatalogModule } from "../../../src/miniapps/catalog/miniapps-catalog.module";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { MiniappsNotificationsClient } from "../../../src/miniapps/notifications/miniapps-notifications.client";
import { MiniappsNotificationsModule } from "../../../src/miniapps/notifications/miniapps-notifications.module";
import { MiniappsNotificationsRepository } from "../../../src/miniapps/notifications/miniapps-notifications.repository";
import { FakeMiniappsManifestClient } from "../../helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { FakeMiniappsNotificationsClient } from "../../helpers/fakes/miniapps/miniapps-notifications.client.fake";
import { FakeMiniappsNotificationsRepository } from "../../helpers/fakes/miniapps/miniapps-notifications.repository.fake";
import { FakeMiniappsRepository } from "../../helpers/fakes/miniapps/miniapps.repository.fake";
import { fixtureRegistry } from "../../helpers/miniapps/registry-fixture";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { miniAppFeed } from "../../../src/miniapps/notifications/miniapps-notifications.wire";

let app: NestExpressApplication;
let httpServer: import("http").Server;

/** A slug that is really in the registry, so 404s in these tests mean what they say. */
const KNOWN_ID = "hssc";

const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

const repository = new FakeMiniappsNotificationsRepository();
const asMock = (spy: jest.SpyInstance): jest.Mock => spy as unknown as jest.Mock;
let listSentNotifications: jest.Mock;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [ConfigModule, SchedulingModule, MiniappsModule, MiniappsNotificationsModule, MiniappsCatalogModule],
    overrides: [
      { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
      { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
      { provide: MiniappsManifestRepository, useValue: new FakeMiniappsManifestRepository() },
      { provide: MiniappsNotificationsRepository, useValue: repository },
      { provide: MiniappsNotificationsClient, useValue: new FakeMiniappsNotificationsClient() },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  listSentNotifications = asMock(jest.spyOn(repository, "listSentNotifications")).mockResolvedValue([]);
});

describe("GET /miniapps/:id/notifications", () => {
  // The app is shared across tests and the feed is cached per replica, so each
  // test jumps the clock past the TTL to start from a cold cache.
  let clock = Date.now();
  beforeEach(() => {
    clock += 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is not swallowed by GET /miniapps/:id", async () => {
    // Arrange
    listSentNotifications.mockResolvedValue([
      {
        _id: "n1",
        miniAppId: KNOWN_ID,
        title_ko: "제목",
        body_ko: "본문",
        title_en: null,
        body_en: null,
        sentAt: new Date("2026-09-01T00:00:00.000Z"),
        delivery: null,
      },
    ]);
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);

    // Act & Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe("n1");
    // The detail route would have returned an object with a startUrl.
    expect(res.body.data).not.toHaveProperty("startUrl");
  });

  it("needs no auth", async () => {
    // Arrange
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);

    // Act & Assert
    expect(res.status).toBe(200);
  });

  it("404s an unknown slug rather than returning an empty feed", async () => {
    // Arrange
    const res = await request(httpServer).get("/miniapps/not-a-real-mini-app/notifications");

    // Act & Assert
    expect(res.status).toBe(404);
    expect(listSentNotifications).not.toHaveBeenCalled();
  });

  it("sets a private Cache-Control no longer than the server's own cache — read seconds after a push, in the request's language", async () => {
    // Arrange
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);

    // Act & Assert
    expect(res.headers["cache-control"]).toBe("private, max-age=3");
  });

  it("returns an empty array, not an error, when nothing has been sent", async () => {
    // Arrange
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);

    // Act & Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("answers a failed read with 500 and no public Cache-Control", async () => {
    // Arrange
    listSentNotifications.mockRejectedValue(new Error("feed read failed"));

    // Act
    const res = await request(httpServer).get(`/miniapps/${KNOWN_ID}/notifications`);

    // Assert
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    // A shared cache must not keep the error (spencer0124/skkuverse#79).
    expect(res.headers["cache-control"] ?? "").not.toMatch(/public|max-age/);
  });
});


describe("GET /miniapps/:id/notifications wire", () => {
  it("serves the published feed shape", async () => {
    // Arrange
    // Another mini app than the tests above read, so its feed cache starts cold.
    listSentNotifications.mockResolvedValue([
      {
        _id: "n1",
        miniAppId: "nsc",
        title_ko: "제목",
        body_ko: "본문",
        title_en: null,
        body_en: null,
        actionType: "route",
        actionValue: "/campus",
        sentAt: new Date("2026-09-01T00:00:00.000Z"),
        delivery: null,
      },
    ]);

    // Act
    const res = await request(httpServer).get("/miniapps/nsc/notifications");

    // Assert
    expect(res.body.data).toHaveLength(1);
    expectWire(miniAppFeed, res.body.data);
  });
});

