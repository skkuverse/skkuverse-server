/**
 * GET /ui/home/transit over main.ts's pipeline (the general limiter UiModule
 * binds on /ui, ResponseInterceptor, HttpExceptionFilter), with the stored
 * `transit-layout` dataset read through FakeUiTransitRepository seeded from
 * fixtures/transit-layout.dataset.json (revision 1 of the dataset), the
 * real bus groups and the real served stations on a fixed clock (2026-10-20,
 * the commute pilot running, fasttrack closed).
 *
 * Asserts the envelope, the three sections in order in Korean, each subway
 * row as one physical station by slug with its lines and no icon, the commute
 * stations group below the commute bus row with its stations, the English
 * titles under unchanged ids, the private five-minute Cache-Control, that no
 * item carries live arrival data, and the wire.
 *
 * Two more apps boot over other stores: one that never held a layout answers
 * 503 TRANSIT_LAYOUT_UNAVAILABLE with no Cache-Control, and one whose layout
 * places a station the server no longer serves serves the rest with 200.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiTransitTabModule } from "../../../src/ui/transit/tab/ui-transit-tab.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { UiTransitRepository } from "../../../src/ui/transit/ui-transit.repository";
import { transitLayout } from "../../../src/ui/transit/ui-transit.wire";
import { UiModule } from "../../../src/ui/ui.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { FakeUiTransitRepository } from "../../helpers/fakes/ui/ui-transit.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

// WHY: 12:00 KST on 2026-10-20, so the commute card is open and the answer does not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

const ARRIVAL_KEY = /arriv|eta|countdown|remaining/i;

/** The layout fixtures/transit-layout.dataset.json holds, as `npm run data` stores it. */
function fixtureLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/transit-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

function storedTransitLayout(layout: Record<string, unknown> | null): FakeUiTransitRepository {
  const repository = new FakeUiTransitRepository();
  if (layout !== null) repository.storeTransitLayout(layout);
  return repository;
}

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, UiModule, UiTransitModule, UiTransitTabModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
      { provide: Clock, useValue: CLOCK },
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
      { provide: UiTransitRepository, useValue: storedTransitLayout(fixtureLayout()) },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...keysOf(nested)]);
}

describe("GET /ui/home/transit", () => {
  it("serves the launch layout in Korean: version 1, campus, hssc and nsc in order", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.sections.map((s: { type: string; id: string; title: string | null }) => [s.type, s.id, s.title])).toEqual([
      ["item_list", "campus", null],
      ["item_list", "hssc", "인사캠"],
      ["item_list", "nsc", "자과캠"],
    ]);
    expectWire(transitLayout, res.body.data);
  });

  it("Hyehwa in Korean: serves 혜화 as a station row with its line and a null subtitle, first in hssc", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[1].items[0]).toEqual({
      kind: "subway",
      id: "subway:hyehwa",
      stationId: "hyehwa",
      title: "혜화역",
      subtitle: null,
      lines: [{ code: "4", name: "4호선", color: "00A5DE", marker: { text: "4", color: "007FAB" } }],
      action: { actionType: "route", actionValue: "/subway?station=hyehwa" },
    });
    expect(res.body.data.sections[2].items[0]).toMatchObject({ id: "subway:sungkyunkwan", lines: [{ code: "1", color: "0052A4", marker: { text: "1", color: "0052A4" } }] });
    expectWire(transitLayout, res.body.data);
  });

  it("Commute stations group: serves group:commute-stations collapsed right below bus:commute in nsc, its stations in the commute chip order", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    const nsc = res.body.data.sections[2];
    expect(nsc.items.map((served: { id: string }) => served.id)).toEqual(["subway:sungkyunkwan", "bus:commute", "group:commute-stations"]);
    const group = nsc.items[2];
    expect({ ...group, items: undefined }).toEqual({
      kind: "group",
      id: "group:commute-stations",
      title: "통학버스 정류장 지하철",
      subtitle: "정자 · 잠실 · 도곡 · 강남 · 양재 · 광교중앙",
      icon: { type: "subway", color: "8B95A1", text: "환승" },
      initialState: "collapsed",
      items: undefined,
    });
    expect(group.items.map((served: { id: string }) => served.id)).toEqual([
      "subway:jeongja",
      "subway:jamsil",
      "subway:dogok",
      "subway:gangnam",
      "subway:yangjae",
      "subway:gwanggyo-jungang",
    ]);
    expect(group.items[2]).toMatchObject({ id: "subway:dogok", subtitle: null, lines: [{ code: "3" }, { code: "K1", color: "F5A200", marker: { text: "수", color: "A26B00" } }] });
    expect(group.items[3]).toEqual({
      kind: "subway",
      id: "subway:gangnam",
      stationId: "gangnam",
      title: "강남역",
      subtitle: null,
      lines: [
        { code: "2", name: "2호선", color: "00A84D", marker: { text: "2", color: "00893F" } },
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
      ],
      action: { actionType: "route", actionValue: "/subway?station=gangnam" },
    });
    expect(keysOf(res.body.data)).not.toContain("visibleWith");
    expectWire(transitLayout, res.body.data);
  });

  it("Transfer station: serves 정자 first in the group with its 신분당 then its 수인분당 line, and a null subtitle", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[2].items[2].items[0]).toEqual({
      kind: "subway",
      id: "subway:jeongja",
      stationId: "jeongja",
      title: "정자역",
      subtitle: null,
      lines: [
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
        { code: "K1", name: "수인분당선", color: "F5A200", marker: { text: "수", color: "A26B00" } },
      ],
      action: { actionType: "route", actionValue: "/subway?station=jeongja" },
    });
    expectWire(transitLayout, res.body.data);
  });

  it.each([
    ["en", "Jeongja Station", ["Shinbundang Line", "신"], ["Suin–Bundang Line", "수"]],
    ["zh", "亭子站", ["新盆唐线", "新"], ["水仁·盆唐线", "水"]],
  ])("Transfer station in %s: serves 정자's line names and marker texts in that language, its colors unchanged", async (lang, title, [d1Name, d1Text], [k1Name, k1Text]) => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[2].items[2].items[0]).toMatchObject({
      title,
      lines: [
        { code: "D1", name: d1Name, color: "D4003B", marker: { text: d1Text, color: "D4003B" } },
        { code: "K1", name: k1Name, color: "F5A200", marker: { text: k1Text, color: "A26B00" } },
      ],
    });
    expectWire(transitLayout, res.body.data);
  });

  it("serves English titles under the same section and item ids", async () => {
    // Act
    const ko = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");
    const en = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "en");

    // Assert
    expect(en.status).toBe(200);
    expect(en.body.meta).toEqual({ lang: "en" });
    expect(en.body.data.sections.map((s: { title: string | null }) => s.title)).toEqual([null, "HSSC", "NSC"]);
    expect(en.body.data.sections[0].items[0].title).toBe("INJA Shuttle");
    const idsOf = (body: { data: { sections: Array<{ id: string; items: Array<{ id: string }> }> } }) =>
      body.data.sections.map((s) => [s.id, s.items.map((served) => served.id)]);
    expect(idsOf(en.body)).toEqual(idsOf(ko.body));
  });

  it.each(["ko", "en", "zh"])("Subway rows carry no subtitle in %s: every station row serves null, and every bus row keeps its own", async (lang) => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", lang);

    // Assert
    expect(res.status).toBe(200);
    type Row = { kind: string; id: string; subtitle: string | null; items?: Row[] };
    const rows = (res.body.data.sections as Array<{ items: Row[] }>).flatMap((s) => s.items).flatMap((row) => [row, ...(row.items ?? [])]);
    expect(rows.filter((row) => row.kind === "subway").map((row) => [row.id, row.subtitle])).toEqual(
      ["hyehwa", "sungkyunkwan", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang"].map((id) => [`subway:${id}`, null]),
    );
    expect(rows.filter((row) => row.kind === "bus").every((row) => typeof row.subtitle === "string" && row.subtitle.length > 0)).toBe(true);
    expectWire(transitLayout, res.body.data);
  });

  it("is cached privately for five minutes and carries no arrival data", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(keysOf(res.body.data).filter((key) => ARRIVAL_KEY.test(key))).toEqual([]);
  });
});

describe("GET /ui/home/transit over other stored layouts", () => {
  let other: NestExpressApplication | undefined;

  async function bootTransit(layout: Record<string, unknown> | null): Promise<import("http").Server> {
    other = await buildTestApp({
      imports: [SchedulingModule, BusModule, UiModule, UiTransitModule, UiTransitTabModule],
      overrides: [
        { provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() },
        { provide: Clock, useValue: CLOCK },
        { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
        { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
        { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
        { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
        { provide: UiTransitRepository, useValue: storedTransitLayout(layout) },
      ],
      role: "api",
    });
    return other.getHttpServer();
  }

  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it("answers 503 TRANSIT_LAYOUT_UNAVAILABLE with no Cache-Control when no layout was ever read", async () => {
    // Arrange
    const server = await bootTransit(null);

    // Act
    const res = await request(server).get("/ui/home/transit");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: "TRANSIT_LAYOUT_UNAVAILABLE", message: "The transit layout is unavailable" });
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it("Campus tags: serves hssc on the hssc section and nsc on the nsc section, and no campus on the inter-campus section", async () => {
    // Arrange
    const layout = fixtureLayout() as { sections: Array<Record<string, unknown>> };
    layout.sections[1]!.campus = "hssc";
    layout.sections[2]!.campus = "nsc";
    const server = await bootTransit(layout);

    // Act
    const res = await request(server).get("/ui/home/transit");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections.map((served: Record<string, unknown>) => [served.id, served.campus])).toEqual([
      ["campus", undefined],
      ["hssc", "hssc"],
      ["nsc", "nsc"],
    ]);
    expect(Object.keys(res.body.data.sections[0])).not.toContain("campus");
    expectWire(transitLayout, res.body.data);
  });

  it("Station removed by a deploy: leaves out a stored station the server no longer serves and serves the rest with 200", async () => {
    // Arrange
    const layout = fixtureLayout() as { sections: Array<{ id: string; items: Array<Record<string, unknown>> }> };
    layout.sections[1]!.items.splice(1, 0, { kind: "subway", stationId: "removed-by-a-deploy" });
    const server = await bootTransit(layout);

    // Act
    const res = await request(server).get("/ui/home/transit");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[1].items.map((served: { id: string }) => served.id)).toEqual([
      "subway:hyehwa",
      "bus:hssc",
      "bus:jongro02",
      "bus:jongro07",
      "bus:jongro08",
    ]);
    expectWire(transitLayout, res.body.data);
  });
});
