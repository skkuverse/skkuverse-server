/**
 * GET /ui/home/transit over main.ts's pipeline (the general limiter UiModule
 * binds on /ui, ResponseInterceptor, HttpExceptionFilter), with the committed
 * transit-layout.json, the real bus groups and the real served stations on a
 * fixed clock (2026-10-20, the commute pilot running, fasttrack closed).
 *
 * Asserts the envelope, the three sections in order in Korean, the English
 * titles under unchanged ids, the private five-minute Cache-Control, that no
 * item carries live arrival data, and the wire.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { UiTransitModule } from "../../../src/ui/transit/ui-transit.module";
import { transitLayout } from "../../../src/ui/transit/ui-transit.wire";
import { UiModule } from "../../../src/ui/ui.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { buildTestApp } from "../../helpers/nest/build-test-app";

// WHY: 12:00 KST on 2026-10-20, so the commute card is open and the answer does not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-20T03:00:00.000Z") };

const ARRIVAL_KEY = /arriv|eta|countdown|remaining/i;

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusModule, UiModule, UiTransitModule],
    overrides: [{ provide: Clock, useValue: CLOCK }],
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
    expect(res.body.data.sections[1].items).toContainEqual({
      kind: "subway",
      id: "subway:S1-4-420",
      stationId: "S1-4-420",
      title: "혜화역",
      subtitle: "4호선",
      icon: { type: "subway", color: "00A5DE", text: "4" },
      action: { actionType: "route", actionValue: "/subway?station=S1-4-420" },
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
