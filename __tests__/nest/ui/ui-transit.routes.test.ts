/**
 * GET /ui/home/transit over main.ts's pipeline (the general limiter UiModule
 * binds on /ui, ResponseInterceptor, HttpExceptionFilter), with the committed
 * transit-layout.json, the real bus groups and the real served stations on a
 * fixed clock (2026-10-20, the commute pilot running, fasttrack closed).
 *
 * Asserts the envelope, the three sections in order in Korean, each subway
 * row as one physical station by slug with its lines and no icon, the commute
 * stations group below the commute bus row with its stations, the English
 * titles under unchanged ids, the private five-minute Cache-Control, that no
 * item carries live arrival data, and the wire.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { transitLayout } from "../../../src/ui/transit/ui-transit.wire";
import { UiModule } from "../../../src/ui/ui.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusRegistryRepository } from "../../helpers/fakes/bus/bus-registry.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

// WHY: 12:00 KST on 2026-10-20, so the commute card is open and the answer does not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

const ARRIVAL_KEY = /arriv|eta|countdown|remaining/i;

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, UiModule, UiTransitModule],
    overrides: [
      { provide: Clock, useValue: CLOCK },
      { provide: BusRegistryRepository, useValue: new FakeBusRegistryRepository() },
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

  it("Hyehwa in Korean: serves 혜화 as a station row with its line, first in hssc", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[1].items[0]).toEqual({
      kind: "subway",
      id: "subway:hyehwa",
      stationId: "hyehwa",
      title: "혜화역",
      subtitle: "4호선",
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
    expect(group.items[2]).toMatchObject({ id: "subway:dogok", subtitle: "3호선 · 수인분당선", lines: [{ code: "3" }, { code: "K1", color: "F5A200", marker: { text: "수", color: "A26B00" } }] });
    expect(group.items[3]).toEqual({
      kind: "subway",
      id: "subway:gangnam",
      stationId: "gangnam",
      title: "강남역",
      subtitle: "2호선 · 신분당선",
      lines: [
        { code: "2", name: "2호선", color: "00A84D", marker: { text: "2", color: "00893F" } },
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
      ],
      action: { actionType: "route", actionValue: "/subway?station=gangnam" },
    });
    expect(keysOf(res.body.data)).not.toContain("visibleWith");
    expectWire(transitLayout, res.body.data);
  });

  it("Transfer station: serves 정자 first in the group with its 신분당 then its 수인분당 line, and their names joined as its subtitle", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit").set("Accept-Language", "ko");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.sections[2].items[2].items[0]).toEqual({
      kind: "subway",
      id: "subway:jeongja",
      stationId: "jeongja",
      title: "정자역",
      subtitle: "신분당선 · 수인분당선",
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

  it("is cached privately for five minutes and carries no arrival data", async () => {
    // Act
    const res = await request(httpServer).get("/ui/home/transit");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(keysOf(res.body.data).filter((key) => ARRIVAL_KEY.test(key))).toEqual([]);
  });
});
