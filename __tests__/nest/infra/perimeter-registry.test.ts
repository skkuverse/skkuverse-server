/**
 * The perimeter registry in Nest (ADR 0023, D4): every port token resolves to one implementation per process from
 * the mode's source, overlay to the entry this build carries and local-dev to the LocalDev classes; the poller
 * constructs every class too, with no internal token to read and no host, and test mode resolves stubs. Through the
 * overlay's ports the retired internal push routes answer 404. The root module imports the registry first, and every
 * route test app gets it from buildTestApp. What the production entry decides is tested beside it, in the overlay.
 */
import { Controller, Get, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import fs from "node:fs";
import request from "supertest";
import path from "node:path";
import { appModuleImports, appModulesUnder } from "../../helpers/nest/app-modules";
import { FakeMiniappsManifestClient } from "../../helpers/fakes/miniapps/miniapps-manifest.client.fake";
import { FakeMiniappsManifestRepository } from "../../helpers/fakes/miniapps/miniapps-manifest.repository.fake";
import { FakeMiniappsNotificationsClient } from "../../helpers/fakes/miniapps/miniapps-notifications.client.fake";
import { FakeMiniappsNotificationsRepository } from "../../helpers/fakes/miniapps/miniapps-notifications.repository.fake";
import { FakeMiniappsRepository } from "../../helpers/fakes/miniapps/miniapps.repository.fake";
import { fixtureRegistry } from "../../helpers/miniapps/registry-fixture";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { Clock } from "../../../src/infra/clock";
import config from "../../../src/infra/config";
import { ConfigModule } from "../../../src/config/config.module";
import { MiniappsManifestClient } from "../../../src/miniapps/manifest/miniapps-manifest.client";
import { MiniappsManifestRepository } from "../../../src/miniapps/manifest/miniapps-manifest.repository";
import { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { MiniappsNotificationsClient } from "../../../src/miniapps/notifications/miniapps-notifications.client";
import { MiniappsNotificationsRepository } from "../../../src/miniapps/notifications/miniapps-notifications.repository";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { LOCAL_DEV_CLASSES } from "../../../src/perimeter/local-dev/perimeter-classes";
import { PerimeterCountersRepository } from "../../../src/perimeter/perimeter-counters.repository";
import { loadOverlayEntry } from "../../../src/perimeter/perimeter-overlay.rules";
import * as registryRules from "../../../src/perimeter/perimeter-registry.rules";
import { perimeterProviders } from "../../../src/perimeter/perimeter.config";
import {
  InternalAuthorizer,
  MiniAppPushAuthorizer,
  MiniAppPushQuota,
  OutboundPolicy,
  PORT_NAMES,
  PORT_TOKENS,
  PushContentPolicy,
  type PerimeterClasses,
  type PortName,
} from "../../../src/perimeter/perimeter.ports";

const NOW = new Date("2026-10-19T16:30:00Z");
const DISPATCH_TOKEN = config.notices.dispatch.internalToken;

/** The registry's providers compiled under `role`, its counters stubbed: nothing here reaches Mongo. */
async function compileRegistry(mode: "overlay" | "local-dev", role: string): Promise<(name: PortName) => unknown> {
  const previous = process.env.ROLE;
  process.env.ROLE = role;
  try {
    const moduleRef = await Test.createTestingModule({ providers: perimeterProviders(mode) })
      .overrideProvider(Clock)
      .useValue({ now: () => NOW })
      .overrideProvider(PerimeterCountersRepository)
      .useValue({ upsertCount: () => Promise.resolve({ count: 1, release: () => Promise.resolve() }) })
      .compile();
    return (name) => moduleRef.get(PORT_TOKENS[name]);
  } finally {
    if (previous === undefined) delete process.env.ROLE;
    else process.env.ROLE = previous;
  }
}

describe("perimeterProviders", () => {
  it.each<[string, "overlay" | "local-dev", () => PerimeterClasses]>([
    ["the overlay entry's classes", "overlay", () => loadOverlayEntry().classes],
    ["the LocalDev classes", "local-dev", () => LOCAL_DEV_CLASSES],
  ])("resolves every port to %s, once", async (_label, mode, classesOf) => {
    // Arrange
    const classes = classesOf();
    const get = await compileRegistry(mode, "api");

    // Act
    const resolved = PORT_NAMES.map((name) => [get(name), get(name)] as const);

    // Assert
    PORT_NAMES.forEach((name, i) => {
      expect(resolved[i]![0]).toBeInstanceOf(classes[name]);
      expect(resolved[i]![1]).toBe(resolved[i]![0]);
    });
  });

  // WHY: the ESKARA push console, the internal push routes' only caller, is retired and the routes with it (ADR 0020,
  // D6); a request it or anyone else sends there finds no route, whatever token it carries.
  it.each<[string, Record<string, string>]>([
    ["the retired push token", { "X-Internal-Token": "retired-miniapp-push-token" }],
    ["the notice dispatch token", { "X-Internal-Token": DISPATCH_TOKEN }],
    ["no token", {}],
  ])("answers the retired internal push send and history with 404 under %s through the overlay's ports, writing and sending nothing", async (_label, headers) => {
    // Arrange
    const get = await compileRegistry("overlay", "api");
    const repository = new FakeMiniappsNotificationsRepository();
    const client = new FakeMiniappsNotificationsClient();
    const app = await buildTestApp({
      imports: [ConfigModule, SchedulingModule, ...appModulesUnder("src/miniapps/")],
      overrides: [
        { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
        { provide: MiniappsManifestClient, useValue: new FakeMiniappsManifestClient() },
        { provide: MiniappsManifestRepository, useValue: new FakeMiniappsManifestRepository() },
        { provide: MiniappsNotificationsRepository, useValue: repository },
        { provide: MiniappsNotificationsClient, useValue: client },
        { provide: Clock, useValue: { now: () => NOW } },
        { provide: InternalAuthorizer, useValue: get("internalAuthorizer") },
        { provide: MiniAppPushAuthorizer, useValue: get("miniAppPushAuthorizer") },
        { provide: MiniAppPushQuota, useValue: get("miniAppPushQuota") },
        { provide: PushContentPolicy, useValue: get("pushContentPolicy") },
      ],
      role: "api",
    });
    const sendPush = jest.spyOn(client, "sendPush");
    const payload = { title_ko: "우천 안내", body_ko: "공연이 30분 지연됩니다.", actionType: "route", actionValue: "/miniapp-feed/eskara-2026" };

    try {
      // Act
      const sent = await request(app.getHttpServer())
        .post("/internal/miniapps/eskara-2026/notifications")
        .set({ "Content-Type": "application/json", ...headers })
        .send(JSON.stringify(payload));
      const history = await request(app.getHttpServer()).get("/internal/miniapps/eskara-2026/notifications").set(headers);

      // Assert
      expect([sent.status, sent.body.error?.code]).toEqual([404, "NOT_FOUND"]);
      expect([history.status, history.body.error?.code]).toEqual([404, "NOT_FOUND"]);
      expect(await repository.listSentNotifications("eskara-2026", 50)).toEqual([]);
      expect(sendPush).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("loads and checks the mode's classes once for every port, and only when Nest builds the providers", async () => {
    // Arrange
    const load = jest.spyOn(registryRules, "perimeterClassesFor");

    try {
      // Act
      const providers = perimeterProviders("overlay");
      const loadsBeforeCompile = load.mock.calls.length;
      const moduleRef = await Test.createTestingModule({ providers })
        .overrideProvider(Clock)
        .useValue({ now: () => NOW })
        .overrideProvider(PerimeterCountersRepository)
        .useValue({ upsertCount: () => Promise.resolve({ count: 1, release: () => Promise.resolve() }) })
        .compile();
      PORT_NAMES.forEach((name) => moduleRef.get(PORT_TOKENS[name]));

      // Assert
      expect(loadsBeforeCompile).toBe(0);
      expect(load.mock.calls).toEqual([["overlay"]]);
    } finally {
      load.mockRestore();
    }
  });

  it("constructs every overlay class on the poller, which holds no internal token and listens nowhere", async () => {
    // Act & Assert
    await expect(compileRegistry("overlay", "poller")).resolves.toBeInstanceOf(Function);
  });

  it("resolves every port to a stub that extends the port in test mode", async () => {
    // Arrange
    const moduleRef = await Test.createTestingModule({ providers: perimeterProviders("test") }).compile();

    // Act
    const stubs = PORT_NAMES.map((name) => moduleRef.get(PORT_TOKENS[name]));

    // Assert
    PORT_NAMES.forEach((name, i) => expect(stubs[i]).toBeInstanceOf(PORT_TOKENS[name]));
  });
});

describe("PerimeterModule", () => {
  @Controller("ping")
  class PingController {
    @Get()
    ping(): { ok: boolean } {
      return { ok: true };
    }
  }

  @Module({ controllers: [PingController] })
  class PingModule {}

  it("is the first module the root module imports", () => {
    // Arrange
    const source = fs.readFileSync(path.join(__dirname, "../../../src/app.module.ts"), "utf8");

    // Act
    const [first] = appModuleImports(source);

    // Assert
    expect(first).toEqual({ name: "PerimeterModule", file: "src/perimeter/perimeter.module" });
  });

  it("fails a test app's close once CORS asked ORIGIN_TRUST without FakeOriginTrust, which it would refuse silently", async () => {
    // Arrange
    const app = await buildTestApp({ imports: [PingModule] });

    // Act
    const res = await request(app.getHttpServer()).get("/ping").set("Origin", "https://webview.skkuverse.com");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await expect(app.close()).rejects.toThrow(
      "ORIGIN_TRUST was asked about https://webview.skkuverse.com with no fake, so CORS refused it silently: pass FakeOriginTrust in buildTestApp's overrides",
    );
  });

  it("closes a test app cleanly when no request sent an Origin", async () => {
    // Arrange
    const app = await buildTestApp({ imports: [PingModule] });

    // Act
    const res = await request(app.getHttpServer()).get("/ping");

    // Assert
    expect(res.status).toBe(200);
    await expect(app.close()).resolves.toBeUndefined();
  });

  it("reaches every route test app through buildTestApp, as test-mode stubs", async () => {
    // Arrange
    const app = await buildTestApp({ imports: [PingModule] });

    try {
      // Act
      const outbound = app.get(OutboundPolicy);

      // Assert
      expect(outbound).toBeInstanceOf(OutboundPolicy);
      expect(() => outbound.requestConfig("notice-attachment")).toThrow(/^OUTBOUND_POLICY\.requestConfig has no implementation/);
    } finally {
      await app.close();
    }
  });
});
