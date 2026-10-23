/**
 * Integration over BusConfigController (ETag/304 through EtagInterceptor) on
 * the production pipeline (buildTestApp); the Jongro stations come from the
 * registry, whose repository is an in-memory fake holding the routes stored on 2026-10-17. Asserts group shape, 404
 * GROUP_NOT_FOUND, 304, per-language ETag difference, and the hssc (11 stations,
 * lastStationIndex 10, refreshInterval 10) / jongro07 (22 stations,
 * refreshInterval 25) screen contents, and each realtime station's `stopId`, last, in the group and the all-groups body.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { busConfig, busGroup } from "../../../src/bus/config/bus-config.wire";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { Clock } from "../../../src/infra/clock";
import appConfig from "../../../src/infra/config";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { busStopsFixture, storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { HSSC_STOP_IDS } from "../../helpers/bus/station-stop-ids";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const registryRepository = storedBusRegistryRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [BusStopsModule, BusConfigModule],
    overrides: [
      { provide: BusRegistryRepository, useValue: registryRepository },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: Clock, useValue: { now: () => new Date("2026-10-20T03:00:00Z") } },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /bus/config", () => {
  it("returns a groups array of 7", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config");

    // Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.groups)).toBe(true);
    expect(res.body.data.groups).toHaveLength(7);
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("returns 304 when If-None-Match matches (root)", async () => {
    // Arrange
    const first = await request(httpServer).get("/bus/config");
    const etag = first.headers.etag;

    // Act
    const second = await request(httpServer).get("/bus/config").set("If-None-Match", etag);

    // Assert
    expect(second.status).toBe(304);
    expect(second.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/config/:groupId", () => {
  it("returns group shape for known id", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("id", "campus");
    expect(res.body.data).toHaveProperty("screenType", "schedule");
    expect(res.body.data).toHaveProperty("label");
    expect(res.body.data).toHaveProperty("visibility");
    expect(res.body.data).toHaveProperty("card");
    expect(res.body.data).toHaveProperty("screen");
  });

  it("returns 404 for unknown groupId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/unknown");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 404 GROUP_NOT_FOUND even with If-None-Match (precedes 304)", async () => {
    // Act
    const res = await request(httpServer)
      .get("/bus/config/unknown")
      .set("If-None-Match", '"anything"');

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 304 when ETag matches", async () => {
    // Arrange
    const first = await request(httpServer).get("/bus/config/campus");

    // Act
    const etag = first.headers.etag;

    // Assert
    expect(etag).toBeDefined();
    const second = await request(httpServer)
      .get("/bus/config/campus")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });

  it("returns different ETag per language", async () => {
    // Arrange
    const ko = await request(httpServer).get("/bus/config/campus");

    // Act
    const en = await request(httpServer)
      .get("/bus/config/campus")
      .set("Accept-Language", "en");

    // Assert
    expect(ko.headers.etag).toBeDefined();
    expect(en.headers.etag).toBeDefined();
    expect(ko.headers.etag).not.toBe(en.headers.etag);
  });

  it("commute serves the spec's group config", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/commute");

    // Assert
    expect(res.status).toBe(200);
    const group = res.body.data;
    expect(group.screenType).toBe("schedule");
    expect(group.screen.services.map((s: { serviceId: string }) => s.serviceId)).toEqual([
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ]);
    expect(group.screen.defaultServiceId).toBe("commute-jeongja");
    expect(group.screen.serviceSelector).toBe("chips");
    expect(group.screen).not.toHaveProperty("showBusCount");
    expect(group.screen.features).toEqual([{ type: "info", url: "https://webview.skkuverse.com/bus/commute/info" }]);
  });

  it("campus screen has services[] and routeBadges", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/campus");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(Array.isArray(screen.services)).toBe(true);
    expect(screen.services.length).toBeGreaterThan(0);
    expect(Array.isArray(screen.routeBadges)).toBe(true);
    expect(screen.routeBadges.length).toBeGreaterThan(0);
  });

  it("hssc screen has dataEndpoint, refreshInterval and stations", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/hssc");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/hssc");
    expect(screen.refreshInterval).toBe(10);
    expect(screen.lastStationIndex).toBe(10);
    expect(Array.isArray(screen.stations)).toBe(true);
    expect(screen.stations).toHaveLength(11);
    expect(screen.stations[0]).toHaveProperty("index", 0);
    expect(screen.stations[0]).toHaveProperty("name");
  });

  it("jongro07 screen has dataEndpoint, refreshInterval and stations", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/jongro07");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/jongro07");
    expect(screen.refreshInterval).toBe(25);
    expect(screen.stations).toHaveLength(22);
    expect(screen.lastStationIndex).toBe(21);
  });

  it("jongro08 has its label, subtitle and 31-stop screen", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/jongro08");

    // Act
    const g = res.body.data;

    // Assert
    expect(g.label).toBe("종로 08");
    expect(g.card.subtitle).toBe("명륜3가 ↔ 종로5가");
    expect(g.screen.dataEndpoint).toBe("/bus/realtime/data/jongro08");
    expect(g.screen.stations).toHaveLength(31);
    expect(g.screen.lastStationIndex).toBe(30);
  });
});

// WHY: a group id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id (spencer0124/skkuverse#82).
describe("GET /bus/config/:groupId with an Object.prototype name", () => {
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])("%s → 404 GROUP_NOT_FOUND", async (groupId) => {
    // Act
    const res = await request(httpServer).get(`/bus/config/${groupId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "GROUP_NOT_FOUND", message: `Unknown groupId: ${groupId}` });
  });
});

describe("GET /bus/config and /bus/config/:groupId bodies", () => {
  it.each(["ko", "en"])("parse with their published wire schemas for every group in %s", async (lang) => {
    // Act
    const config = await request(httpServer).get("/bus/config").set("Accept-Language", lang);
    const ids: string[] = config.body.data.groups.map((group: { id: string }) => group.id);
    const groups = await Promise.all(ids.map((id) => request(httpServer).get(`/bus/config/${id}`).set("Accept-Language", lang)));

    // Assert
    expect(config.status).toBe(200);
    expectWire(busConfig, config.body.data);
    expect(groups.map((res) => res.status)).toEqual(ids.map(() => 200));
    for (const res of groups) expectWire(busGroup, res.body.data);
  });
});

describe("GET /bus/config/:groupId refresh", () => {
  it("offers a traffic refresh on each campus service, and none on fasttrack", async () => {
    // Act
    const campus = await request(httpServer).get("/bus/config/campus");
    const fasttrack = await request(httpServer).get("/bus/config/fasttrack");

    // Assert
    expect(campus.status).toBe(200);
    expectWire(busGroup, campus.body.data);
    for (const service of campus.body.data.screen.services) expect(service.refresh).toEqual({ targets: ["traffic"], intervalSec: 60 });
    expect(fasttrack.status).toBe(200);
    expectWire(busGroup, fasttrack.body.data);
    expect(fasttrack.body.data.screen.services[0]).not.toHaveProperty("refresh");
  });
});

// WHY: the Jongro stations come from the registry: each Jongro group names its
// stations version, a stored change reaches a revalidating client as a 200, and a missing route is a 503.
describe("GET /bus/config and the registry", () => {
  async function withCacheOff(run: () => Promise<void>): Promise<void> {
    const previous = appConfig.cache.enabled;
    appConfig.cache.enabled = false;
    try {
      await run();
    } finally {
      appConfig.cache.enabled = previous;
    }
  }

  it("gives each Jongro group its stored stations version and the HSSC group none", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config");

    // Assert
    expect(res.status).toBe(200);
    expectWire(busConfig, res.body.data);
    const versions = res.body.data.groups.map((g: { id: string; screen: { stationsVersion?: string } }) => [g.id, g.screen.stationsVersion ?? null]);
    expect(versions).toEqual([
      ["hssc", null],
      ["campus", null],
      ["fasttrack", null],
      ["commute", null],
      ["jongro02", registryRepository.routes.get("jongro02")!.stationsVersion],
      ["jongro07", registryRepository.routes.get("jongro07")!.stationsVersion],
      ["jongro08", registryRepository.routes.get("jongro08")!.stationsVersion],
    ]);
  });

  it("answers 200 with the new stations, not 304, to the ETag from before a stored change", async () => {
    // Arrange
    const doc = registryRepository.routes.get("jongro07")!;
    const stored = structuredClone(doc);
    const before = await request(httpServer).get("/bus/config");

    await withCacheOff(async () => {
      try {
        doc.stations = [doc.stations[1]!, doc.stations[0]!, ...doc.stations.slice(2)].map((s, index) => ({ ...s, sequence: index + 1 }));
        doc.stationsVersion = "synced";

        // Act
        const after = await request(httpServer).get("/bus/config").set("If-None-Match", before.headers.etag);

        // Assert
        expect(after.status).toBe(200);
        const jongro07 = after.body.data.groups.find((g: { id: string }) => g.id === "jongro07");
        expect(jongro07.screen.stationsVersion).toBe("synced");
        expect(jongro07.screen.stations[0].name).toBe("학생회관");
      } finally {
        registryRepository.routes.set("jongro07", stored);
      }
    });
  });

  // WHY: a client that sees a new stationsVersion on /bus/live refetches its group with Cache-Control: no-cache, which its
  // HTTP cache sends as a revalidation (If-None-Match): a 304 while nothing changed, the new stations once something did.
  it("revalidates a group: 304 while its stations are unchanged, 200 with the new version and ETag once they change", async () => {
    // Arrange
    const doc = registryRepository.routes.get("jongro07")!;
    const stored = structuredClone(doc);

    await withCacheOff(async () => {
      try {
        const first = await request(httpServer).get("/bus/config/jongro07");
        const revalidate = (etag: string) => request(httpServer).get("/bus/config/jongro07").set("Cache-Control", "no-cache").set("If-None-Match", etag);
        const unchanged = await revalidate(first.headers.etag);
        doc.stations = [doc.stations[1]!, doc.stations[0]!, ...doc.stations.slice(2)].map((s, index) => ({ ...s, sequence: index + 1 }));
        doc.stationsVersion = "synced";

        // Act
        const changed = await revalidate(first.headers.etag);
        const again = await revalidate(changed.headers.etag);

        // Assert
        expect(first.body.data.screen.stationsVersion).toBe(stored.stationsVersion);
        expect([unchanged.status, unchanged.text]).toEqual([304, ""]);
        expect(changed.status).toBe(200);
        expectWire(busGroup, changed.body.data);
        expect(changed.headers.etag).not.toBe(first.headers.etag);
        expect(changed.headers["cache-control"]).toBe("private, max-age=300");
        expect(changed.body.data.screen.stationsVersion).toBe("synced");
        expect(again.status).toBe(304);
      } finally {
        registryRepository.routes.set("jongro07", stored);
      }
    });
  });

  it("answers 503 JONGRO_REGISTRY_UNAVAILABLE for the config and a group when a route is missing", async () => {
    // Arrange
    const stored = registryRepository.routes.get("jongro08")!;
    registryRepository.routes.delete("jongro08");

    await withCacheOff(async () => {
      try {
        // Act
        const all = await request(httpServer).get("/bus/config");
        const one = await request(httpServer).get("/bus/config/jongro08");

        // Assert
        expect([all.status, one.status]).toEqual([503, 503]);
        expect(all.body.error.code).toBe("JONGRO_REGISTRY_UNAVAILABLE");
        expect(one.body.error.code).toBe("JONGRO_REGISTRY_UNAVAILABLE");
      } finally {
        registryRepository.routes.set("jongro08", stored);
      }
    });
  });
});

// WHY: the app draws a stop's map card exactly when `map` is there (owner, 2026-10-18).
describe("GET /bus/config stop maps", () => {
  type Stop = { id: string; map?: unknown };

  it.each(["ko", "en", "zh"])("Commute stops without maps: no commute stop has a map, every campus stop keeps one (%s)", async (lang) => {
    // Act
    const [commute, campus, all] = await Promise.all(
      ["/bus/config/commute", "/bus/config/campus", "/bus/config"].map((url) => request(httpServer).get(url).set("Accept-Language", lang)),
    );

    // Assert
    expect([commute!.status, campus!.status, all!.status]).toEqual([200, 200, 200]);
    const commuteStops: Stop[] = commute!.body.data.screen.stops;
    const campusStops: Stop[] = campus!.body.data.screen.stops;
    expect(commuteStops.length).toBeGreaterThan(0);
    for (const stop of commuteStops) expect(stop).not.toHaveProperty("map");
    expect(campusStops.map((stop) => stop.id)).toEqual(expect.arrayContaining(["nsc-n-center", "nsc-opposite"]));
    for (const stop of campusStops) expect(stop).toHaveProperty("map", { markers: [], paths: [] });
    const groups: Array<{ id: string; screen: { stops?: Stop[] } }> = all!.body.data.groups;
    expect(groups.find((group) => group.id === "commute")!.screen.stops).toEqual(commuteStops);
    expect(groups.find((group) => group.id === "campus")!.screen.stops).toEqual(campusStops);
    expectWire(busGroup, commute!.body.data);
    expectWire(busConfig, all!.body.data);
  });
});

describe("GET /bus/config realtime station stop ids", () => {
  type Station = { index: number; stationNumber: string | null; stopId?: string };
  type Group = { id: string; screen: { stations: Station[] } };

  it("Jongno station: serves 종로07's station 01592 with stopId seoul-01592 after transferLines", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expectWire(busGroup, res.body.data);
    const station = (res.body.data as Group).screen.stations.find((candidate) => candidate.stationNumber === "01592")!;
    expect(station.stopId).toBe("seoul-01592");
    expect(Object.keys(station).slice(-2)).toEqual(["transferLines", "stopId"]);
  });

  it("Non-stop HSSC position: serves the HSSC stations their stop ids, and index 5 no stopId key", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/hssc").set("Accept-Language", "zh");

    // Assert
    expect(res.status).toBe(200);
    expectWire(busGroup, res.body.data);
    const stations = (res.body.data as Group).screen.stations;
    expect(stations.map((station) => station.stopId ?? null)).toEqual(HSSC_STOP_IDS);
    expect(stations[5]).not.toHaveProperty("stopId");
  });

  it("serves the same stations in /bus/config as in each realtime group", async () => {
    // Act
    const config = await request(httpServer).get("/bus/config");
    const groups = await Promise.all(["hssc", "jongro02", "jongro07", "jongro08"].map((id) => request(httpServer).get(`/bus/config/${id}`)));

    // Assert
    expectWire(busConfig, config.body.data);
    for (const res of groups) {
      const group = res.body.data as Group;
      expect(group.screen.stations.filter((station) => station.stopId !== undefined).length).toBeGreaterThan(0);
      expect((config.body.data.groups as Group[]).find((candidate) => candidate.id === group.id)!.screen.stations).toEqual(group.screen.stations);
    }
  });
});

// WHY: the app labels a pass-through row as non-stop instead of showing an arrival, which is never served there.
describe("GET /bus/config realtime station pass-through", () => {
  type Station = { isPassThrough?: unknown };
  type Group = { id: string; screen: { stations: Station[] } };

  it("serves the HSSC 혜화동로터리 positions (indexes 5 and 7) isPassThrough true, every other station false, as the wire declares", async () => {
    // Act
    const config = await request(httpServer).get("/bus/config");
    const hssc = await request(httpServer).get("/bus/config/hssc");

    // Assert
    expect(config.status).toBe(200);
    expect(hssc.status).toBe(200);
    expectWire(busConfig, config.body.data);
    expectWire(busGroup, hssc.body.data);
    const flags = (hssc.body.data as Group).screen.stations.map((station) => station.isPassThrough);
    expect(flags).toEqual([false, false, false, false, false, true, false, true, false, false, false]);
    const jongro = (config.body.data.groups as Group[]).filter((group) => group.id.startsWith("jongro"));
    expect(jongro).toHaveLength(3);
    for (const group of jongro) expect(group.screen.stations.every((station) => station.isPassThrough === false)).toBe(true);
  });
});

describe("GET /bus/config/hssc for a bus-stops revision without HSSC subtitles", () => {
  type Station = { name: string; subtitle: string | null };

  let bareApp: NestExpressApplication;

  beforeAll(async () => {
    const data = busStopsFixture() as { hssc: { stations: Array<Record<string, unknown>> } };
    for (const station of data.hssc.stations) delete station.subtitle;
    bareApp = await buildTestApp({
      imports: [BusStopsModule, BusConfigModule],
      overrides: [
        { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
        { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
        { provide: BusStopsRepository, useValue: storedBusStopsRepository(data) },
        { provide: Clock, useValue: { now: () => new Date("2026-10-20T03:00:00Z") } },
      ],
      role: "api",
    });
  });

  afterAll(async () => {
    await bareApp.close();
  });

  it("serves every HSSC station with subtitle null, keeping its Korean name", async () => {
    // Act
    const res = await request(bareApp.getHttpServer()).get("/bus/config/hssc");

    // Assert
    expect(res.status).toBe(200);
    expectWire(busGroup, res.body.data);
    const stations = (res.body.data as { screen: { stations: Station[] } }).screen.stations;
    expect(stations).toHaveLength(11);
    expect(stations.map((station) => station.subtitle)).toEqual(Array(11).fill(null));
    expect(stations[0]!.name).toBe("농구장");
  });
});

// WHY: riders cannot board at the 하교 direction's drop-off-only stops, so the app must not show those rows as boardable.
describe("GET /bus/config realtime station drop-off only", () => {
  type Station = { isAlightOnly?: unknown };
  type Group = { id: string; screen: { stations: Station[] } };

  let flaggedApp: NestExpressApplication;

  beforeAll(async () => {
    const data = busStopsFixture() as { hssc: { stations: Array<Record<string, unknown>> } };
    data.hssc.stations[3]!.isAlightOnly = true;
    data.hssc.stations[4]!.isAlightOnly = true;
    flaggedApp = await buildTestApp({
      imports: [BusStopsModule, BusConfigModule],
      overrides: [
        { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
        { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
        { provide: BusStopsRepository, useValue: storedBusStopsRepository(data) },
        { provide: Clock, useValue: { now: () => new Date("2026-10-20T03:00:00Z") } },
      ],
      role: "api",
    });
  });

  afterAll(async () => {
    await flaggedApp.close();
  });

  it("serves every station isAlightOnly false for a revision that stores no flag", async () => {
    // Act
    const config = await request(httpServer).get("/bus/config");

    // Assert
    expect(config.status).toBe(200);
    expectWire(busConfig, config.body.data);
    const realtime = (config.body.data.groups as Group[]).filter((group) => group.id === "hssc" || group.id.startsWith("jongro"));
    expect(realtime).toHaveLength(4);
    for (const group of realtime) expect(group.screen.stations.map((station) => station.isAlightOnly)).toEqual(group.screen.stations.map(() => false));
  });

  it("serves 올림픽기념국민생활관 and 혜화동우체국 (indexes 3 and 4) isAlightOnly true where the data flags them, every other station false, as the wire declares", async () => {
    // Act
    const config = await request(flaggedApp.getHttpServer()).get("/bus/config");
    const hssc = await request(flaggedApp.getHttpServer()).get("/bus/config/hssc");

    // Assert
    expect(config.status).toBe(200);
    expect(hssc.status).toBe(200);
    expectWire(busConfig, config.body.data);
    expectWire(busGroup, hssc.body.data);
    expect((hssc.body.data as Group).screen.stations.map((station) => station.isAlightOnly)).toEqual([false, false, false, true, true, false, false, false, false, false, false]);
    const jongro = (config.body.data.groups as Group[]).filter((group) => group.id.startsWith("jongro"));
    expect(jongro).toHaveLength(3);
    for (const group of jongro) expect(group.screen.stations.every((station) => station.isAlightOnly === false)).toBe(true);
  });
});
