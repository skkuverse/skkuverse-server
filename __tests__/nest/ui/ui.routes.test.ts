/**
 * The /ui home routes over main.ts's pipeline: the general limiter (UiModule
 * binds it on /ui), the four sub-module controllers, ResponseInterceptor and
 * HttpExceptionFilter. The SDUI payloads, i18n text and meta counts come from
 * the real code, the committed config files and the real bus groups.
 *
 * Asserts the dynamic meta.busListCount / meta.itemCount, item shapes, lang
 * defaulting, the English i18n switch, the /home/campus section structure, the
 * Cache-Control of /home and /home/campus, and that /home/transitlist and
 * /home/scroll send none.
 *
 * The home layout is the stored `home-layout` dataset (ADR 0013), read through
 * FakeUiHomeRepository seeded from fixtures/home-layout.dataset.json. Two more
 * apps boot over other stores: one that never held a layout answers 503 with no
 * Cache-Control, and one whose layout names a mini app the registry does not
 * hold serves the rest of the layout.
 *
 * The campus banners are the stored `campus-banners` dataset, read through
 * FakeUiCampusRepository seeded from fixtures/campus-banners.dataset.json. Two
 * more apps boot over other stores: one that never held banners answers 503
 * CAMPUS_BANNERS_UNAVAILABLE with no Cache-Control, and one whose banner opens
 * a mini app the registry does not hold serves the other banner.
 *
 * The mini app registry is the stored `miniapps` dataset, read through
 * FakeMiniappsRepository seeded from the dataset fixture
 * (__tests__/nest/miniapps/fixtures/miniapps.dataset.json).
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { Clock } from "../../../src/infra/clock";
import { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiCampusModule } from "../../../src/ui/campus/ui-campus.module";
import { UiCampusRepository } from "../../../src/ui/campus/ui-campus.repository";
import { UiHomeModule } from "../../../src/ui/home/ui-home.module";
import { UiHomeRepository } from "../../../src/ui/home/ui-home.repository";
import { UiScrollModule } from "../../../src/ui/scroll/ui-scroll.module";
import { UiTransitListModule } from "../../../src/ui/transit-list/ui-transit-list.module";
import { UiModule } from "../../../src/ui/ui.module";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { FakeMiniappsRepository } from "../../helpers/fakes/miniapps/miniapps.repository.fake";
import { FakeUiCampusRepository } from "../../helpers/fakes/ui/ui-campus.repository.fake";
import { FakeUiHomeRepository } from "../../helpers/fakes/ui/ui-home.repository.fake";
import { fixtureRegistry } from "../../helpers/miniapps/registry-fixture";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { campusSheet } from "../../../src/ui/campus/ui-campus.wire";
import { homeLayout } from "../../../src/ui/home/ui-home.wire";
import { scrollCards, scrollCardsMeta } from "../../../src/ui/scroll/ui-scroll.wire";
import { transitList, transitListMeta } from "../../../src/ui/transit-list/ui-transit-list.wire";

// WHY: one fixed instant (12:00 KST, 2026-10-14), so the answers do not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

/** The layout fixtures/home-layout.dataset.json holds, as `npm run data` stores it. */
function fixtureLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/home-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

function storedHomeLayout(layout: Record<string, unknown> | null): FakeUiHomeRepository {
  const repository = new FakeUiHomeRepository();
  if (layout !== null) repository.storeHomeLayout(layout);
  return repository;
}

/** The banners fixtures/campus-banners.dataset.json holds, as `npm run data` stores them. */
function fixtureBanners(): Record<string, unknown> {
  const banners = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/campus-banners.dataset.json"), "utf8")) as Record<string, unknown>;
  delete banners._about;
  return banners;
}

function storedCampusBanners(banners: Record<string, unknown> | null): FakeUiCampusRepository {
  const repository = new FakeUiCampusRepository();
  if (banners !== null) repository.storeCampusBanners(banners);
  return repository;
}

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, UiModule, UiHomeModule, UiTransitListModule, UiScrollModule, UiCampusModule],
    overrides: [
      { provide: Clock, useValue: CLOCK },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: UiHomeRepository, useValue: storedHomeLayout(fixtureLayout()) },
      { provide: UiCampusRepository, useValue: storedCampusBanners(fixtureBanners()) },
      { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
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

  it("sends no Cache-Control: a card appears on its window's first minute", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transitlist");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBeUndefined();
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

  it("sends no Cache-Control", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/scroll");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("GET /ui/home/campus", () => {
  it("returns minAppVersion and no section once every banner has closed", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    // Every banner of revision 1 ended with ESKARA 2026 (ui-campus.mapper.spec.ts
    // pins the window), and the service buttons moved to the map's chip row.
    expect(res.body.data).toEqual({ minAppVersion: "2.0.0", sections: [] });
  });

  it("is cacheable like /ui/home", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/campus");

    // Assert
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(res.headers.vary).toMatch(/Accept-Language/);
  });
});

describe("GET /ui/home", () => {
  it("returns the layout in the standard envelope, cacheable by the client alone since it is in the request's language", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.body.data.version).toBe(1);
    expect(Array.isArray(res.body.data.sections)).toBe(true);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
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

/**
 * Each served body against its wire schema (PR 219 F2): the contract fixtures were captured once,
 * so a field the mappers start to serve without a wire declaring it shows only here. The envelope's
 * own `meta.lang` is not part of a meta wire.
 */
describe("/ui bodies against their wire schemas", () => {
  it("serves /ui/home as homeLayout declares", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home");

    // Assert
    expect(res.status).toBe(200);
    expectWire(homeLayout, res.body.data);
  });

  it("serves /ui/home/campus as campusSheet declares", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/campus");

    // Assert
    expect(res.status).toBe(200);
    expectWire(campusSheet, res.body.data);
  });

  it("serves /ui/home/scroll as scrollCards and scrollCardsMeta declare", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/scroll");
    const { lang, ...meta } = res.body.meta;

    // Assert
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expect(res.body.data.length).toBeGreaterThan(0);
    expectWire(scrollCards, res.body.data);
    expectWire(scrollCardsMeta, meta);
  });

  it("serves /ui/home/transitlist as transitList and transitListMeta declare", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transitlist");
    const { lang, ...meta } = res.body.meta;

    // Assert
    expect(res.status).toBe(200);
    expect(lang).toBe("ko");
    expect(res.body.data.length).toBeGreaterThan(0);
    expectWire(transitList, res.body.data);
    expectWire(transitListMeta, meta);
  });
});

describe("GET /ui/home over other stored layouts", () => {
  let other: NestExpressApplication | undefined;

  async function bootHome(layout: Record<string, unknown> | null): Promise<import("http").Server> {
    other = await buildTestApp({
      imports: [UiModule, UiHomeModule],
      overrides: [
        { provide: Clock, useValue: CLOCK },
        { provide: UiHomeRepository, useValue: storedHomeLayout(layout) },
        { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
      ],
      role: "api",
    });
    return other.getHttpServer();
  }

  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it("answers 503 HOME_LAYOUT_UNAVAILABLE with no Cache-Control when no layout was ever read", async () => {
    // Arrange
    const server = await bootHome(null);

    // Act
    const res = await request(server).get("/ui/home");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: "HOME_LAYOUT_UNAVAILABLE", message: "The home layout is unavailable" });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("leaves out the tile of a mini app the registry no longer holds and serves the rest with 200", async () => {
    // Arrange
    const layout = fixtureLayout() as { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
    const tiles = layout.sections.find((section) => section.type === "tile_grid")!.tiles!;
    const servedTileIds = tiles.map((tile) => tile.id);
    tiles.splice(1, 0, { kind: "miniapp", id: "removed-by-a-deploy" });
    const server = await bootHome(layout);

    // Act
    const res = await request(server).get("/ui/home");

    // Assert
    expect(res.status).toBe(200);
    const grid = res.body.data.sections.find((section: { type: string }) => section.type === "tile_grid");
    expect(grid.tiles.map((tile: { id: string }) => tile.id)).toEqual(servedTileIds);
    expectWire(homeLayout, res.body.data);
  });
});

describe("GET /ui/home/campus over other stored banners", () => {
  let other: NestExpressApplication | undefined;

  async function bootCampus(banners: Record<string, unknown> | null): Promise<import("http").Server> {
    other = await buildTestApp({
      imports: [UiModule, UiCampusModule],
      overrides: [
        { provide: Clock, useValue: CLOCK },
        { provide: UiCampusRepository, useValue: storedCampusBanners(banners) },
        { provide: MiniappsRepository, useValue: FakeMiniappsRepository.seededWith(fixtureRegistry()) },
      ],
      role: "api",
    });
    return other.getHttpServer();
  }

  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it("answers 503 CAMPUS_BANNERS_UNAVAILABLE with no Cache-Control when no banners were ever read", async () => {
    // Arrange
    const server = await bootCampus(null);

    // Act
    const res = await request(server).get("/ui/home/campus");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: "CAMPUS_BANNERS_UNAVAILABLE", message: "The campus banners are unavailable" });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("leaves out the banner of a mini app the registry no longer holds and serves the other with 200", async () => {
    // Arrange
    const banners = fixtureBanners() as { items: Array<Record<string, unknown>> };
    const [kept, removed] = banners.items.slice(0, 2).map(({ endAt: _endAt, ...open }) => open);
    banners.items = [{ ...removed, actionType: "miniapp", actionValue: "removed-by-a-deploy" }, kept!];
    const server = await bootCampus(banners);

    // Act
    const res = await request(server).get("/ui/home/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections.map((section: { items: Array<{ id: string }> }) => section.items.map((banner) => banner.id))).toEqual([[kept!.id]]);
    expectWire(campusSheet, res.body.data);
  });
});
