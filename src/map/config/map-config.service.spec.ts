/**
 * MapConfigService builds /map/config from the base map and the live layer
 * set: layers, chips and camera defaults, labels resolved per language, and
 * the base map kept when the festival lookup fails.
 */

// The layer sets are the stored dataset's fixture, in FakeMapLayerSetRepository; one test stores a set that
// fails its checks, which the read leaves out.

import { pick } from "../../infra/i18n";
import type { Clock } from "../../infra/clock";
import { FakeMapLayerSetRepository } from "../../../__tests__/helpers/fakes/map/map-layer-set.repository.fake";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { fixtureLayerSet, fixtureLayerSets, fixtureLayerSetRepository } from "../../../__tests__/helpers/map/layer-sets-fixture";
import type { MapLayerSetRepository } from "../layer-set/map-layer-set.repository";
import type { LayerSet } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import { EVENT_CACHE_TTL_MS } from "../map.constants";
import type { MapRepository } from "../map.repository";
import { MapConfigService } from "./map-config.service";

// building_numbers, building_labels, the inert `campus_geometry` layer that exists so
// campus_shapes documents have a layerId they can legally name, the three opt-in Jongno route lines and the HSSC line.
const BASE_LAYER_COUNT = 7;

/**
 * Revision 1 of the stored layer sets, the set production serves for the
 * festival, so every expectation below derives from it rather than restating
 * a count that the next festival would break.
 */
const CONFIG: LayerSet = fixtureLayerSet();

const CLOCK: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };

// The chips /map/config serves off-season, read through the layer-set service as the config service reads them.
const BASE_CHIPS = new MapLayerSetService(
  asReal<MapRepository>(new FakeMapRepository()),
  asReal<MapLayerSetRepository>(new FakeMapLayerSetRepository()),
  CLOCK,
).servedChipSpecs(null);
const EVENT_LAYER_IDS = new Set(CONFIG.layers.map((l) => l.id));

// "No festival" is stated rather than inferred from an absent DB client, and
// the live case can be exercised at all.
const mockFindActiveActivation = jest.fn<ReturnType<MapRepository["findActiveActivation"]>, [Date]>();
const findActiveActivation: MapRepository["findActiveActivation"] = mockFindActiveActivation;

describe("MapConfigService", () => {
  let config: MapConfigService;
  let layerSets: FakeMapLayerSetRepository;
  // The event read path is cached per service instance; each test starts cold.
  function freshServices(): void {
    const repository = new FakeMapRepository();
    repository.findActiveActivation = findActiveActivation;
    layerSets = fixtureLayerSetRepository();
    config = new MapConfigService(
      new MapLayerSetService(asReal<MapRepository>(repository), asReal<MapLayerSetRepository>(layerSets), CLOCK),
    );
  }
  const svc = {
    getMapConfig: (lang: "ko" | "en" | "zh") => config.getMapConfig(lang),
  };

  beforeEach(() => {
    freshServices();
    mockFindActiveActivation.mockReset();
    mockFindActiveActivation.mockResolvedValue(null);
  });

  it("getMapConfig labels the campuses per language and serves only the base layers off-season", async () => {
    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    expect(ko.campuses).toHaveLength(2);
    // The BASE layers and nothing else: no activation is live above.
    expect(ko.layers).toHaveLength(BASE_LAYER_COUNT);
    expect(ko.campuses[0]!.label).toBe("인사캠");
    expect((await svc.getMapConfig("en")).campuses[0]!.label).toBe("HSSC");
  });

  it("sends a userConfigurable flag on every layer", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    // Derived, not a magic 8: hardcoding the count couples a test about
    // visibility flags to the two commented-out bus layers staying commented,
    // and uncommenting them would fail here with a misleading diagnosis.
    expect(ko.layers.length).toBe(BASE_LAYER_COUNT + CONFIG.layers.length);
    // Guards the `every` below, which passes vacuously on an empty array.
    expect(ko.layers.length).toBeGreaterThan(0);

    // Nothing is locked today; the capability exists for a future always-on
    // background layer. `typeof … === "boolean"` would be a tautology here —
    // the field is required by LayerEntry and tsc is green — so assert the
    // VALUE instead.
    expect(ko.layers.every((l) => typeof l.userConfigurable === "boolean")).toBe(true);
    // And the values, because this axis has a meaningful `false`: the inert
    // campus geometry layer is the one occupant of the defined-but-inert
    // quadrant, and it must not grow a toggle for a layer with nothing in it.
    const byId = new Map(ko.layers.map((l) => [l.id, l.userConfigurable]));
    expect(byId.get("building_numbers")).toBe(true);
    expect(byId.get("building_labels")).toBe(true);
    expect(byId.get("campus_geometry")).toBe(false);
  });

  it.each(["ko", "en", "zh"] as const)(
    "resolves every layer label in %s as a STRING, through the one I18n resolver",
    async (lang) => {
      // Arrange
      mockFindActiveActivation.mockResolvedValue({
        _id: "eskara-2026",
      } as Awaited<ReturnType<typeof findActiveActivation>>);

      // Act
      const res = await svc.getMapConfig(lang);

      // Assert
      for (const layer of res.layers) {
        // A `{ko, en, zh}` object leaking through the `...rest` spread would
        // serialize as JSON and render "[object Object]" in the filter grid.
        expect(typeof layer.label).toBe("string");
        expect(layer.label.length).toBeGreaterThan(0);
      }
      for (const def of CONFIG.layers) {
        expect(res.layers.find((l) => l.id === def.id)!.label).toBe(pick(def.label, lang));
      }
    },
  );

  it("getMapConfig appends the live layer set's layers, as the config declares them", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const eventLayers = ko.layers.filter((l) => EVENT_LAYER_IDS.has(l.id));

    expect(eventLayers).toHaveLength(CONFIG.layers.length);
    // All share ONE endpoint, which is what makes six toggles cost one fetch.
    expect(new Set(eventLayers.map((l) => l.endpoint))).toEqual(
      new Set(["/map/overlays/event"]),
    );
    // defaultVisibleWhen is the config's, layer by layer — the amenities layer ships
    // opt-in and the bars layer ships scheduled, and both have to survive the projection
    // intact. It rides to the wire through the `...rest` spread rather than a
    // named copy, so a shape change here is what would catch a regression.
    // markerStyle likewise: it used to be the constant "placeDot" on every
    // festival layer, and the restricted-zone layers are where a config first chose
    // otherwise, so the wire has to follow the file rather than the old default.
    for (const def of CONFIG.layers) {
      const served = eventLayers.find((l) => l.id === def.id)!;
      expect(served.markerStyle).toBe(def.markerStyle);
      expect(served.defaultVisibleWhen).toEqual(
        def.defaultVisibleWhen,
      );
    }
    expect(CONFIG.layers.some((l) => l.defaultVisibleWhen.kind === "never")).toBe(true);
    expect(CONFIG.layers.some((l) => l.defaultVisibleWhen.kind === "scheduled")).toBe(true);
    expect(eventLayers.find((l) => l.id === "eskara26_bar")!.label).toBe("주점");
  });

  it("serves the base layers only when the live layer set has no usable config", async () => {
    // An activation for a set this build has no file for — a deploy that
    // forgot CONFIG_FILES, or ops naming a set that does not exist yet. The
    // buildings must not disappear over it, and no chip may point at a layer
    // the same response does not carry.
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2099",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    expect(ko.layers.map((l) => l.id)).toEqual(["building_numbers", "building_labels", "campus_geometry", "jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"]);
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("serves the base layers only when the live layer set's config was REJECTED", async () => {
    // The posture, end to end: a config typo freezes the snapshot at its last
    // good version (the materializer's rule) AND takes the festival off the
    // campus map — layers, chips and, through the same lookup, markers —
    // rather than serve layers whose category table it cannot trust. The two
    // surfaces disagree for as long as the file is broken, which is the price
    // of never serving a layer set that failed validation.
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
    const rejected = fixtureLayerSets();
    (rejected.layerSets[0] as { itemDefaults: { fallback: { layerId: string } } }).itemDefaults.fallback.layerId = "nope";
    layerSets.storeLayerSets(rejected);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    expect(ko.layers.map((l) => l.id)).toEqual(["building_numbers", "building_labels", "campus_geometry", "jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"]);
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("getMapConfig keeps the festival through a database blip after a good read", async () => {
    // The app caches a festival-less /map/config for minutes, so dropping the
    // event layers on one failed read would hide the festival long after the
    // database recovered. The cached activation covers the gap instead.
    // Arrange
    let clock = Date.now();
    const spy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      mockFindActiveActivation.mockResolvedValue({
        _id: "eskara-2026",
      } as Awaited<ReturnType<typeof findActiveActivation>>);
      const before = await svc.getMapConfig("ko");

      // Act
      mockFindActiveActivation.mockRejectedValue(new Error("mongo down"));
      clock += EVENT_CACHE_TTL_MS;
      const during = await svc.getMapConfig("ko");

      // Assert
      expect(during.layers.map((l) => l.id)).toEqual(before.layers.map((l) => l.id));
      expect(during.layers.some((l) => EVENT_LAYER_IDS.has(l.id))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("getMapConfig keeps the base layers when the activation lookup throws", async () => {
    // Arrange
    mockFindActiveActivation.mockRejectedValue(new Error("mongo down"));

    // Act
    // The whole point of containing that read: a festival lookup failing must
    // not take building_numbers down with it.
    const ko = await svc.getMapConfig("ko");

    // Assert
    expect(ko.layers).toHaveLength(BASE_LAYER_COUNT);
    expect(ko.layers.map((l) => l.id)).toEqual([
      "building_numbers",
      "building_labels",
      "campus_geometry",
      "jongro02_route",
      "jongro08_route",
      "jongro07_route",
      "hssc_route",
    ]);
  });

  it("declares a chipGroupId on every layer, null on the building layers", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const groupById = new Map(ko.layers.map((l) => [l.id, l.chipGroupId]));

    // null is the load-bearing value, not an omission: it is what keeps building_numbers
    // and building_labels visible and user-toggleable while a festival chip swaps the
    // six festival layers around them.
    expect(groupById.get("building_numbers")).toBeNull();
    expect(groupById.get("building_labels")).toBeNull();
    // The group is the layer set id, so two festivals could never share one.
    for (const layer of ko.layers.filter((l) => EVENT_LAYER_IDS.has(l.id))) {
      expect(layer.chipGroupId).toBe(CONFIG.layerSetId);
    }
  });

  it("gates the chips on the same activation read as the layers", async () => {
    // Act & Assert
    const dark = await svc.getMapConfig("ko");
    expect(dark.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
    // One request, one activation read. Two lookups could also disagree if the
    // window closed between them, serving chips that point at layers no longer
    // in the same response.
    expect(mockFindActiveActivation).toHaveBeenCalledTimes(1);

    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);
    // The activation is cached; drop it so the second request sees the change.
    freshServices();

    const live = await svc.getMapConfig("ko");
    // Reset chip plus every authored one.
    expect(live.chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
  });

  it("never names a layer the same response does not carry", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const served = new Set(ko.layers.map((l) => l.id));
    const focusChips = ko.chips.filter((c) => c.action.kind === "focus");

    expect(focusChips.length).toBeGreaterThan(0);
    for (const chip of focusChips) {
      if (chip.action.kind !== "focus") continue;
      expect(chip.action.layerIds.length).toBeGreaterThan(0);
      for (const layerId of chip.action.layerIds) {
        // The reason chips ride inside /map/config rather than beside it: a
        // reference and its target cannot be fetched a minute apart, so they
        // cannot disagree on the wire.
        expect(served.has(layerId)).toBe(true);
      }
    }
  });

  it("keeps the base chips when the activation lookup throws", async () => {
    // Arrange
    mockFindActiveActivation.mockRejectedValue(new Error("mongo down"));

    // Act
    // Containment covers chips too — a festival lookup failing must answer
    // "no festival" and leave the base row exactly as it is, the same way it
    // must not take building_numbers down with the booths.
    const ko = await svc.getMapConfig("ko");

    // Assert
    expect(ko.chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("serves the camera settings the app used to hardcode", async () => {
    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    // `zoom: 17.5` and `duration: 500` were literals at three call sites in
    // CampusScreen, so a chip's camera and a marker-tap camera were configured
    // in two places that could disagree about how close "close" is.
    expect(ko.cameraDefaults.markerFocus).toEqual({
      zoom: 17.5,
      tilt: 0,
      bearing: 0,
      durationMs: 500,
    });
    expect(ko.cameraDefaults.campusFocus.durationMs).toBeGreaterThan(0);

    // Parsed by the client since before this deploy, never sent until it —
    // defaultTilt could only ever hold its own fallback.
    for (const campus of ko.campuses) {
      expect(campus.defaultTilt).toBe(0);
    }
    // NSC is turned to square its grid to the screen; HSSC stays north-up.
    expect(Object.fromEntries(ko.campuses.map((c) => [c.id, c.defaultBearing]))).toEqual({
      hssc: 0,
      nsc: 6,
    });
  });

  it("serves the marker geometry the app used to hardcode", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const byId = new Map(ko.layers.map((l) => [l.id, l]));

    // DOT_SIZE, and the label layer's globalZIndex.
    expect(byId.get("building_numbers")!.style).toMatchObject({ size: 16 });
    expect(byId.get("building_labels")!.style).toMatchObject({ zIndex: 100000 });

    // Zooming out drops the numbers before the names, and neither is gone at
    // the view a campus opens on.
    const numbersMin = byId.get("building_numbers")!.style!.minZoom!;
    const labelsMin = byId.get("building_labels")!.style!.minZoom!;
    expect(numbersMin).toBeGreaterThan(labelsMin);
    for (const campus of ko.campuses) {
      expect(numbersMin).toBeLessThan(campus.defaultZoom);
    }

    // PIN_WIDTH x PIN_HEIGHT — the tintable base icon's natural proportions, so
    // a client honouring them does not distort the tint.
    const bar = byId.get("eskara26_bar")!;
    expect(bar.style).toMatchObject({ width: 22, height: 30 });
    // Colour still ships for the festival layers: a category colour is content,
    // and it comes from the config. The building layers deliberately send none
    // — their fill is a design token that resolves per theme, and a hex from
    // here cannot.
    expect(bar.style!.color).toBe(CONFIG.layers.find((l) => l.id === "eskara26_bar")!.color);
    expect(byId.get("building_numbers")!.style!.color).toBeUndefined();
  });

  it("draws a festival zone as a fill with no outline", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const zone = ko.layers.find((l) => l.id === "eskara26_control_entry")!;
    expect(zone).toBeDefined();

    // Fill only, asked for by the student council on 2026-09-22. The two halves fail in
    // OPPOSITE directions, which is why both are asserted: drop `fillOpacity`
    // and the client's polygon falls back to opaque black over the booths it
    // covers; keep an `outlineWidth` and the border they asked us to remove is
    // simply back. Neither is visible to a test run that only checks the
    // response parses.
    expect(zone.style!.fillOpacity).toBeGreaterThan(0);
    expect(zone.style!.outlineWidth).toBe(0);
    // Not merely a zero width. A colour for a stroke that cannot be drawn is a
    // field that can only ever be inert, which is the one thing every field on
    // this wire is not allowed to be.
    expect(zone.style!.outlineColor).toBeUndefined();
  });

  /**
   * Asserted on the WIRE rather than on the layer set JSON, and the difference
   * is the point. The layer-set schema (map-layer-set.schema.ts) reads five named
   * members out of each authored layer and builds a fresh object, so a "shape"
   * typed into a stored layer set is dropped and could never reach a response. A
   * test guarding the layer set would pass while someone stamped a shape onto
   * EVENT_LAYER_STYLE, which is the edit that would actually ship one.
   */
  it("sends no style.shape, leaving every place marker on the client's dot-then-pin default", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    // Selected by markerStyle rather than by the eskara ids: `placeDot` is the
    // only client branch that reads the shape axis, so this is exactly the set
    // the rule covers — and it picks up next year's festival for free.
    const placeDotLayers = ko.layers.filter((l) => l.markerStyle === "placeDot");

    // Guards the loop below, which would pass vacuously on an empty array. The
    // count comes FROM the config rather than from its length, because a
    // festival layer may now choose `textLabel` — and that is correctly outside
    // this rule, since a bare caption has no pin for a shape to describe.
    const authoredPlaceDots = CONFIG.layers.filter((l) => l.markerStyle === "placeDot");
    expect(authoredPlaceDots.length).toBeGreaterThan(0);
    expect(placeDotLayers).toHaveLength(authoredPlaceDots.length);

    for (const layer of placeDotLayers) {
      // A style object is always built, so an absent key below is the wire
      // declining to say rather than there being nowhere to say it.
      expect(layer.style).toBeDefined();
      // The client reads an absent `shape` as `dotThenPin`. Sending
      // "dotThenPin" explicitly would agree with today's client and freeze a
      // default that is meant to move with it, so silence IS the setting.
      // Object.keys rather than a member access: MapLayerStyle has no `shape`,
      // deliberately, so `layer.style.shape` would not compile.
      expect(Object.keys(layer.style ?? {})).not.toContain("shape");
    }
  });

  it("draws the building layers on both tabs, the route lines on the transit tab only and a festival layer on the map tab only", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const tabsById = new Map(ko.layers.map((l) => [l.id, l.tabs]));
    for (const id of ["building_numbers", "building_labels", "campus_geometry"]) {
      expect(tabsById.get(id)).toEqual(["map", "transit"]);
    }
    for (const id of ["jongro02_route", "jongro07_route", "jongro08_route", "hssc_route"]) {
      expect(tabsById.get(id)).toEqual(["transit"]);
    }
    // Absent, not ["map"]: an absent field is what installed builds already read as the map tab.
    const festivalLayers = ko.layers.filter((l) => EVENT_LAYER_IDS.has(l.id));
    expect(festivalLayers.length).toBeGreaterThan(0);
    for (const layer of festivalLayers) expect(layer).not.toHaveProperty("tabs");
  });

  it("keeps chipGroupId null on every layer the transit tab draws", async () => {
    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    // Installed builds treat any grouped layer as festival content and hide its toggle, so a
    // grouped route line would take the Jongno route toggles away from every user on an old build.
    const transitLayers = ko.layers.filter((l) => l.tabs?.includes("transit"));
    expect(transitLayers.length).toBeGreaterThan(0);
    for (const layer of transitLayers) expect(layer.chipGroupId).toBeNull();
  });

  it.each(["ko", "en", "zh"] as const)("serves no shuttle routes chip in %s, while still serving the four route line layers", async (lang) => {
    // Act
    const served = await svc.getMapConfig(lang);

    // Assert
    // The transit tab draws a picked bus's line itself, so a chip turning all four on duplicated it.
    expect(served.chips.find((c) => c.id === "shuttle_routes")).toBeUndefined();
    expect(served.chips.filter((c) => c.action.kind === "layers")).toEqual([]);
    // The app's line sheet turns `<groupId>_route` on from this list to draw a selected line.
    const layerIds = served.layers.map((l) => l.id);
    expect(layerIds).toEqual(expect.arrayContaining(["jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"]));
  });

  it.each([
    ["ko", "건물코드"],
    ["en", "Building Code"],
    ["zh", "建筑编号"],
  ] as const)("serves the building code chip in %s with an empty tabs, so the shared-map shell lists it in no tab", async (lang, label) => {
    // Act
    const served = await svc.getMapConfig(lang);

    // Assert
    // The shared-map shell's search field replaces it; builds that ignore `tabs` keep it in the map tab.
    expect(served.chips.find((c) => c.id === "building_code")).toEqual({
      id: "building_code",
      label,
      icon: { kind: "emoji", emoji: "🔢" },
      action: { kind: "link", actionType: "route", actionValue: "/search" },
      isReset: false,
      list: null,
      tabs: [],
    });
  });

  it.each(["ko", "en", "zh"] as const)("serves building_map, lost_found and inquiry to both tabs in %s, running where they are tapped", async (lang) => {
    // Act
    const served = await svc.getMapConfig(lang);

    // Assert
    // For now the transit tab shows the map tab's chips; a link chip opens a page, so it names no opensIn.
    const mirrored = served.chips.filter((c) => ["building_map", "lost_found", "inquiry"].includes(c.id));
    expect(mirrored.map((c) => c.id)).toEqual(["building_map", "lost_found", "inquiry"]);
    for (const chip of mirrored) {
      expect(chip.tabs).toEqual(["map", "transit"]);
      expect(chip).not.toHaveProperty("opensIn");
    }
  });

  it("keeps every festival chip on the map tab, stating neither tabs nor opensIn", async () => {
    // Arrange
    mockFindActiveActivation.mockResolvedValue({
      _id: "eskara-2026",
    } as Awaited<ReturnType<typeof findActiveActivation>>);

    // Act
    const ko = await svc.getMapConfig("ko");

    // Assert
    const baseIds = new Set(BASE_CHIPS.map((c) => c.id));
    const festivalChips = ko.chips.filter((c) => !baseIds.has(c.id));
    expect(festivalChips).toHaveLength(1 + CONFIG.chips.length);
    for (const chip of festivalChips) {
      expect(chip).not.toHaveProperty("tabs");
      expect(chip).not.toHaveProperty("opensIn");
    }
  });

  // The three legacy /map/overlays tests that stood here are gone with their
  // methods: getOverlaysByCategory and computeEtag served a hardcoded building
  // table that the v2 migration orphaned, and getOverlayById served a jongro
  // polyline that no client rendered. Their coverage moved to
  // map.routes.test.ts, which now pins that both URLs 404.
});
