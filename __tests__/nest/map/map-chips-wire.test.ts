/**
 * GET /map/config end to end, through the production pipeline and the real
 * map services.
 *
 * `map.routes.test.ts` checks the envelope of every /map route, and
 * `src/map/config/map-config.service.spec.ts` checks the shape the service
 * builds. Neither proves the two meet: a field could be built correctly and
 * still be dropped by a controller return type, an interceptor, or a
 * serialization step. This is the test that reads the bytes a client receives.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";

import { BuildingRepository } from "../../../src/building/building.repository";
import { MapCampusModule } from "../../../src/map/campus/map-campus.module";
import { MapConfigModule } from "../../../src/map/config/map-config.module";
import { MapEventDetailsModule } from "../../../src/map/event-details/map-event-details.module";
import { MapEventModule } from "../../../src/map/event/map-event.module";
import { BASE_CHIPS } from "../../../src/map/layer-set/map-layer-set.constants";
import { MapLayerSetModule } from "../../../src/map/layer-set/map-layer-set.module";
import { MapModule } from "../../../src/map/map.module";
import { MapRepository } from "../../../src/map/map.repository";
import { MapLayerSetRepository } from "../../../src/map/layer-set/map-layer-set.repository";
import { fixtureLayerSet, fixtureLayerSetRepository } from "../../helpers/map/layer-sets-fixture";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeMapRepository } from "../../helpers/fakes/map/map.repository.fake";
import { Clock } from "../../../src/infra/clock";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { mapConfig } from "../../../src/map/config/map-config.wire";

// WHY: one fixed instant (12:00 KST, 2026-10-14), so the answers do not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-14T03:00:00.000Z") };

// No DB in either direction: buildings fall back (an empty fake), and "no
// festival" is stated rather than inferred from an absent Mongo client.
const mockFindActiveActivation = jest.fn<ReturnType<MapRepository["findActiveActivation"]>, [Date]>();
const findActiveActivation: MapRepository["findActiveActivation"] = mockFindActiveActivation;

// Revision 1 of the stored layer sets, which the fake repository serves; the counts below derive from it.
const CONFIG = fixtureLayerSet();

describe("GET /map/config (real map services)", () => {
  let app: NestExpressApplication;
  let httpServer: ReturnType<NestExpressApplication["getHttpServer"]>;
  // The activation is cached per app, so each test boots a cold one. Only the
  // repositories are fakes: buildings and campus shapes empty, the activation
  // read stated per test.
  beforeEach(async () => {
    const mapRepository = new FakeMapRepository();
    mapRepository.findActiveActivation = findActiveActivation;
    app = await buildTestApp({
      imports: [MapModule, MapLayerSetModule, MapConfigModule, MapCampusModule, MapEventModule, MapEventDetailsModule],
      overrides: [
        { provide: BuildingRepository, useValue: new FakeBuildingRepository() },
        { provide: MapRepository, useValue: mapRepository },
        { provide: MapLayerSetRepository, useValue: fixtureLayerSetRepository() },
        { provide: Clock, useValue: CLOCK },
      ],
      role: "api",
    });
    httpServer = app.getHttpServer();
    mockFindActiveActivation.mockReset();
    mockFindActiveActivation.mockResolvedValue(null);
  });

  afterEach(async () => {
    await app.close();
  });

  it("carries the chips and the camera defaults through the envelope", async () => {
    // Act
    const res = await request(httpServer).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko" });

    const { chips, cameraDefaults, layers, campuses } = res.body.data;

    expect(chips.map((c: { id: string }) => c.id)).toEqual(
      BASE_CHIPS.map((c) => c.id),
    );
    expect(cameraDefaults.markerFocus).toEqual({
      zoom: 17.5,
      tilt: 0,
      bearing: 0,
      durationMs: 500,
    });
    expect(campuses[0].defaultTilt).toBe(0);

    // `chipGroupId: null` has to SURVIVE serialization. An `undefined` here
    // would vanish from the JSON entirely and the client would read the absent
    // field as "no group" by accident rather than by contract.
    expect(layers[0]).toHaveProperty("chipGroupId", null);
    expect(JSON.stringify(res.body)).toContain('"chipGroupId":null');

    // `defaultVisibleWhen` is a NESTED OBJECT where every other layer field is
    // a scalar, and it reaches the wire through the `...rest` spread rather
    // than a named copy — so an interceptor or a serialization step dropping it
    // would be invisible to every other test.
    expect(layers[0]).toHaveProperty("defaultVisibleWhen", { kind: "always" });
    expect(layers.every((l: { defaultVisibleWhen?: unknown }) => l.defaultVisibleWhen)).toBe(true);
  });

  it("serves the four permanent link chips with no festival live, as the wire declares", async () => {
    // Act
    const res = await request(httpServer).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapConfig, res.body.data);
    expect(res.body.data.chips).toEqual([
      {
        id: "building_map",
        label: "건물지도",
        icon: { kind: "emoji", emoji: "🏢" },
        action: { kind: "link", actionType: "route", actionValue: "/map/hssc" },
        isReset: false,
        list: null,
      },
      {
        id: "building_code",
        label: "건물코드",
        icon: { kind: "emoji", emoji: "🔢" },
        action: { kind: "link", actionType: "route", actionValue: "/search" },
        isReset: false,
        list: null,
      },
      {
        id: "lost_found",
        label: "분실물",
        icon: { kind: "emoji", emoji: "🧳" },
        action: { kind: "link", actionType: "webview", actionValue: "https://webview.skkuverse.com/skku/lostandfound" },
        isReset: false,
        list: null,
      },
      {
        id: "inquiry",
        label: "문의하기",
        icon: { kind: "emoji", emoji: "💬" },
        action: { kind: "link", actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" },
        isReset: false,
        list: null,
      },
      {
        id: "shuttle_routes",
        label: "셔틀 노선",
        icon: { kind: "emoji", emoji: "🚌" },
        action: { kind: "layers", layerIds: ["jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"], camera: null },
        isReset: false,
        list: null,
        tabs: ["map", "transit"],
        opensIn: "map",
      },
    ]);
  });

  it("carries the transit tab lens through the envelope, as the wire declares", async () => {
    // Act
    const res = await request(httpServer).get("/map/config");

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapConfig, res.body.data);
    const shuttleRoutes = res.body.data.chips.find((c: { id: string }) => c.id === "shuttle_routes");
    expect(shuttleRoutes).toEqual({
      id: "shuttle_routes",
      label: "셔틀 노선",
      icon: { kind: "emoji", emoji: "🚌" },
      action: { kind: "layers", layerIds: ["jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"], camera: null },
      isReset: false,
      list: null,
      tabs: ["map", "transit"],
      opensIn: "map",
    });
    // `camera: null` has to survive serialization: it means "do not move", which an absent key does not say.
    expect(JSON.stringify(shuttleRoutes.action)).toContain('"camera":null');
    const tabsById = new Map(res.body.data.layers.map((l: { id: string; tabs?: string[] }) => [l.id, l.tabs]));
    expect(tabsById.get("building_numbers")).toEqual(["map", "transit"]);
    expect(tabsById.get("hssc_route")).toEqual(["transit"]);
  });

  it("adds the festival chips while an activation is open", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const res = await request(httpServer)
      .get("/map/config")
      .set("Accept-Language", "en");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.lang).toBe("en");
    // Reset chip plus every authored chip, in that order.
    expect(res.body.data.chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
    expect(res.body.data.chips[BASE_CHIPS.length].id).toBe("eskara-2026_all");

    // The row's order is authored copy too: 주점, 부스, 푸드트럭, 입장 팔찌 배부 lead,
    // right after the festival's own chip. 공연 has no chip while it has no place.
    expect(
      res.body.data.chips.slice(BASE_CHIPS.length).map((c: { id: string }) => c.id),
    ).toEqual([
      "eskara-2026_all",
      "eskara26_view_bar",
      "eskara26_view_booth",
      "eskara26_view_food",
      "eskara26_view_entry",
      "eskara26_view_facility",
      "eskara26_view_control",
    ]);

    const foodChip = res.body.data.chips.find(
      (c: { id: string }) => c.id === "eskara26_view_food",
    );
    // English, because the envelope is what varies on Accept-Language — and the
    // LAYER's label: a single-layer chip authors none, so the pill and the
    // filter sheet read the same "Food trucks", authored copy that a deploy
    // must not quietly change.
    expect(foodChip.label).toBe("Food trucks");
    const foodLayer = res.body.data.layers.find(
      (l: { id: string }) => l.id === "eskara26_food",
    );
    expect(foodLayer.label).toBe(foodChip.label);
    expect(foodChip.icon).toEqual({ kind: "emoji", emoji: "🚚" });
    expect(foodChip.action).toEqual({
      kind: "focus",
      camera: {
        lat: 37.2962298,
        lng: 126.9716456,
        zoom: 17.2,
        tilt: 0,
        bearing: 6,
        durationMs: 500,
      },
      layerIds: ["eskara26_food"],
    });
    expect(foodChip.isReset).toBe(false);

    // The reset chip's two halves, on the bytes: `isReset` says what the tap
    // means, `layerIds` still says which group it is scoped to. Serving the
    // second empty would leave it group-less.
    const resetWire = res.body.data.chips.find(
      (c: { id: string }) => c.id === "eskara-2026_all",
    );
    expect(resetWire.isReset).toBe(true);
    expect(resetWire.label).toBe("ESKARA");
    expect(resetWire.icon).toEqual({ kind: "emoji", emoji: "🌊" });
    expect(resetWire.action.layerIds.length).toBeGreaterThan(0);
    expect(resetWire.action.layerIds).not.toContain("eskara26_facility");
    expect(
      res.body.data.chips.filter((c: { isReset: boolean }) => c.isReset),
    ).toHaveLength(1);

    // A scheduled layer's windows survive serialization as authored,
    // including one that wraps past midnight.
    const barLayer = res.body.data.layers.find(
      (l: { id: string }) => l.id === "eskara26_bar",
    );
    expect(barLayer.defaultVisibleWhen).toEqual({
      kind: "scheduled",
      windows: [{ start: "18:00", end: "04:00" }],
    });
    // The bar chip's label is the layer's plural, not the singular the chip
    // used to author for itself.
    const barChip = res.body.data.chips.find(
      (c: { id: string }) => c.id === "eskara26_view_bar",
    );
    expect(barChip.label).toBe("Bars");
    expect(barLayer.label).toBe("Bars");

    // No webview chip ships since 분실물 was removed, so there is no absolute
    // URL to assert end to end. The rule it used to prove — a relative string
    // reaching a URL opener is the shape of an open redirect, which is why
    // toWebviewUrl resolves server-side rather than leaving the join to the
    // client — is unit-tested in __tests__/nest/infra/webview-url.test.ts, and
    // src/map/map.rules.spec.ts is where restoring this assertion gets prompted.
    expect(
      res.body.data.chips.filter(
        (c: { action: { kind: string } }) => c.action.kind === "webview",
      ),
    ).toHaveLength(0);
  });

  it("serves each list's facets and sort, labels in the request's language", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    const chipsIn = async (lang: string) =>
      (await request(httpServer).get("/map/config").set("Accept-Language", lang)).body.data
        .chips as Array<{ id: string; list: any }>;
    const byId = (chips: Array<{ id: string; list: any }>, id: string) =>
      chips.find((c) => c.id === id)!;

    // Act
    const ko = await chipsIn("ko");
    const en = await chipsIn("en");

    // Assert
    const booth = byId(ko, "eskara26_view_booth").list;
    expect(booth).toEqual({
      facets: [
        {
          id: "day",
          label: "일자",
          select: "required",
          options: [
            {
              id: "day1",
              label: "10/1(목)",
              window: { startAt: "2026-09-30T21:00:00.000Z", endAt: "2026-10-01T21:00:00.000Z" },
            },
            {
              id: "day2",
              label: "10/2(금)",
              window: { startAt: "2026-10-01T21:00:00.000Z", endAt: "2026-10-02T21:00:00.000Z" },
            },
          ],
        },
        {
          id: "org",
          label: "운영",
          select: "optional",
          options: [
            { id: "council", label: "총학생회", window: null },
            { id: "club", label: "학생단체", window: null },
          ],
        },
      ],
      sort: { key: "order", scopeFacetId: "day" },
    });
    expect(byId(ko, "eskara26_view_food").list.sort).toEqual({ key: "title", scopeFacetId: null });
    expect(byId(ko, "eskara26_view_bar").list.facets.map((f: { id: string }) => f.id)).toEqual(["day"]);

    // `null`, not absent: the reset chip lists everything, and so does a chip
    // with no authored list.
    expect(byId(ko, "eskara-2026_all").list).toBeNull();
    expect(byId(ko, "eskara26_view_facility").list).toBeNull();

    expect(byId(en, "eskara26_view_booth").list.facets[0].options[0].label).toBe("Oct 1 (Thu)");
    expect(byId(en, "eskara26_view_booth").list.facets[1].options[1].label).toBe("Student groups");
  });
});
