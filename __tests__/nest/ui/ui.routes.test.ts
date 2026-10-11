/**
 * The /ui home routes over main.ts's pipeline: the general limiter (UiModule
 * binds it on /ui), the four sub-module controllers, ResponseInterceptor and
 * HttpExceptionFilter. The SDUI payloads, i18n text and meta counts come from
 * the real code, the committed config files and the real bus groups.
 *
 * Asserts the dynamic meta.busListCount / meta.itemCount, item shapes, lang
 * defaulting, the English i18n switch, the /home/campus section structure and
 * the Cache-Control of /home and /home/campus.
 */
// The home and campus flows read the mini-app registry through MiniAppsModule,
// whose feed service creates its Mongo index at init and whose manifest service
// prefetches each first-party manifest over the network; the transit list reads
// the bus groups through BusModule, whose schedule service and estimate pollers
// create their Mongo indexes at init. None of them is part of these routes.
jest.mock("../../../src/miniapps/miniapps.data", () => ({
  ensureIndexes: jest.fn(async () => undefined),
}));
jest.mock("../../../src/bus/schedule/schedule-db", () => ({
  ...jest.requireActual("../../../src/bus/schedule/schedule-db"),
  ensureScheduleIndexes: jest.fn(async () => undefined),
}));
jest.mock("../../../src/bus/eta/eta-store", () => ({
  ...jest.requireActual("../../../src/bus/eta/eta-store"),
  ensureEtaIndexes: jest.fn(async () => undefined),
}));

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiCampusModule } from "../../../src/ui/campus/ui-campus.module";
import { UiHomeModule } from "../../../src/ui/home/ui-home.module";
import { UiScrollModule } from "../../../src/ui/scroll/ui-scroll.module";
import { UiTransitListModule } from "../../../src/ui/transit-list/ui-transit-list.module";
import { UiModule } from "../../../src/ui/ui.module";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
const realFetch = global.fetch;

beforeAll(async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error("no network in tests")) as unknown as typeof fetch;
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, UiModule, UiHomeModule, UiTransitListModule, UiScrollModule, UiCampusModule],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  global.fetch = realFetch;
});

describe("GET /ui/home/transitlist", () => {
  it("returns busList with dynamic meta count", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transitlist");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.busListCount).toBeGreaterThanOrEqual(4);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.length).toBe(res.body.meta.busListCount);
  });

  it("each busList item has groupId, card, and action", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transitlist");

    // Assert
    for (const item of res.body.data) {
      expect(item).toHaveProperty("groupId");
      expect(item).toHaveProperty("card");
      expect(item.card).toHaveProperty("label");
      expect(item.card).toHaveProperty("themeColor");
      expect(item.card).toHaveProperty("iconType");
      expect(item.card).toHaveProperty("busTypeText");
      expect(item).toHaveProperty("action");
      expect(item.action).toHaveProperty("route");
      expect(item.action).toHaveProperty("groupId");
      expect(["/bus/realtime", "/bus/schedule"]).toContain(item.action.route);
    }
  });

  it("returns English text with Accept-Language: en", async () => {
    // Act
    const res = await request(httpServer)
      .get("/ui/home/transitlist")
      .set("Accept-Language", "en");

    // Assert
    expect(res.body.meta.lang).toBe("en");
    expect(res.body.data[0].card.label).toBe("HSSC Shuttle Bus");
  });
});

describe("GET /ui/home/scroll", () => {
  it("returns scroll items with correct meta count", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/scroll");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.itemCount).toBe(3);
    expect(res.body.data).toHaveLength(3);
  });

  it("each item has required fields", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/scroll");

    // Assert
    for (const item of res.body.data) {
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("pageLink");
      expect(item).toHaveProperty("useAltPageLink");
    }
  });
});

describe("GET /ui/home/campus", () => {
  it("returns minAppVersion and the button_grid, with no carousel once every banner has closed", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data).toHaveProperty("minAppVersion", "2.0.0");
    expect(Array.isArray(res.body.data.sections)).toBe(true);
    // Every committed banner ended with ESKARA 2026 (ui-campus.config.spec.ts
    // pins the window); the carousel itself is covered there.
    expect(res.body.data.sections.map((s: { type: string }) => s.type)).toEqual([
      "button_grid",
    ]);
    const section = res.body.data.sections[0];
    expect(section).toHaveProperty("columns", 4);
    expect(Array.isArray(section.items)).toBe(true);
    expect(section.items).toHaveLength(4);
    for (const item of section.items) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("actionType");
      expect(item).toHaveProperty("actionValue");
    }
  });

  it("is cacheable like /ui/home", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/campus");

    // Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.vary).toMatch(/Accept-Language/);
  });
});

describe("GET /ui/home", () => {
  it("returns the layout in the standard envelope, cacheable", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.version).toBe(1);
    expect(Array.isArray(res.body.data.sections)).toBe(true);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.vary).toMatch(/Accept-Language/);
  });

  it("ships tile grids with a kind on every tile, and localized titles", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home").set("Accept-Language", "en");

    // Assert
    const grids = res.body.data.sections.filter(
      (s: { type: string }) => s.type === "tile_grid",
    );
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) {
      for (const tile of g.tiles) {
        expect(["miniapp", "game", "link"]).toContain(tile.kind);
        expect(typeof tile.id).toBe("string");
      }
      if (g.title !== undefined) expect(typeof g.title).toBe("string");
    }
  });
});
