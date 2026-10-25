/**
 * The /map/config body: campuses labelled in the request's language, layers
 * with their label resolved and every other field passed through in order,
 * chips with a resolved label, an absolute web view URL and their list, and
 * the camera defaults. The chip row is also projected as /map/config serves
 * it, base chips plus the live festival's from revision 1 of `map-layer-sets`,
 * read through MapLayerSetService as the config service reads it.
 */
import type { Clock } from "../../infra/clock";
import { pick } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../shared/webview-origin.constants";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import type { MapLayerSetRepository } from "../layer-set/map-layer-set.repository";
import { fixtureLayerSet, fixtureLayerSetRepository } from "../../../__tests__/helpers/map/layer-sets-fixture";
import type { MapChipSpec } from "../layer-set/map-layer-set.types";
import { BASE_LAYERS } from "../map.constants";
import type { MapRepository } from "../map.repository";
import type { LayerSpec } from "../map.types";
import { toMapChips, toMapConfig, toMapLayers } from "./map-config.mapper";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";

const CLOCK: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };
const LAYER_SET = new MapLayerSetService(
  asReal<MapRepository>(new FakeMapRepository()),
  asReal<MapLayerSetRepository>(fixtureLayerSetRepository()),
  CLOCK,
);

const LANGS = ["ko", "en", "zh"] as const;
const CONFIG = fixtureLayerSet();
const BASE_CHIPS = LAYER_SET.servedChipSpecs(null);

/** What /map/config serves while this festival is live. */
const CATALOGUE = LAYER_SET.servedLayerSpecs(CONFIG);
// undefined for an id the catalogue lacks, else the layer's chip group (null: no chip may touch it).
const chipGroupOf = (layerId: string): string | null | undefined => CATALOGUE.find((layer) => layer.id === layerId)?.chipGroupId;
const SERVED = LAYER_SET.servedChipSpecs(CONFIG);

const camera = { lat: 37.29, lng: 126.97, zoom: 17, tilt: 0, bearing: 6, durationMs: 500 };

const LIST_CHIP: MapChipSpec = {
  id: "bar",
  emoji: "🍺",
  label: { ko: "주점", en: "Bars" },
  action: { kind: "focus", camera, layerIds: ["eskara26_bar"] },
  isReset: false,
  list: {
    facets: [
      {
        id: "day",
        label: { ko: "일자" },
        source: "hours",
        select: "required",
        options: [{ id: "d1", label: { ko: "1일차" }, window: { from: new Date("2026-09-30T21:00:00Z"), until: new Date("2026-10-01T21:00:00Z") } }],
      },
    ],
    sort: { key: "order", scopeFacetId: "day" },
  },
};

describe("toMapLayers", () => {
  it("resolves the label and keeps every other field, in the spec's order", () => {
    // Act
    const [numbers] = toMapLayers(BASE_LAYERS, "en");

    // Assert
    expect(numbers?.label).toBe("Building Numbers");
    expect(Object.keys(numbers ?? {})).toEqual([
      "id",
      "markerStyle",
      "label",
      "defaultVisibleWhen",
      "userConfigurable",
      "endpoint",
      "chipGroupId",
      "style",
      "tabs",
    ]);
  });
});

describe("toMapChips", () => {
  it("resolves labels per language and a facet window to ISO instants", () => {
    // Act
    const [chip] = toMapChips([LIST_CHIP], "en");

    // Assert
    expect(chip).toMatchObject({ id: "bar", label: "Bars", icon: { kind: "emoji", emoji: "🍺" }, isReset: false });
    expect(chip?.list?.facets[0]?.options[0]).toEqual({
      id: "d1",
      label: "1일차",
      window: { startAt: "2026-09-30T21:00:00.000Z", endAt: "2026-10-01T21:00:00.000Z" },
    });
  });

  it("sends a web view chip's URL absolute", () => {
    // Arrange
    const webview: MapChipSpec = { ...LIST_CHIP, action: { kind: "webview", url: "/lost-found" }, list: null };

    // Act & Assert
    expect(toMapChips([webview], "ko")[0]?.action).toEqual({ kind: "webview", url: `${WEBVIEW_ORIGIN}/lost-found` });
  });

  it("sends a link chip as the shared link shape, a web view value absolute and any other as written", () => {
    // Arrange
    const link = (actionType: "webview" | "route" | "external", actionValue: string): MapChipSpec => ({
      ...LIST_CHIP,
      action: { kind: "link", actionType, actionValue },
      list: null,
    });
    const specs = [link("webview", "/skku/lostandfound"), link("route", "/search"), link("external", "https://pf.kakao.com/_cjxexdG/chat")];

    // Act
    const actions = toMapChips(specs, "ko").map((chip) => chip.action);

    // Assert
    expect(actions).toEqual([
      { kind: "link", actionType: "webview", actionValue: `${WEBVIEW_ORIGIN}/skku/lostandfound` },
      { kind: "link", actionType: "route", actionValue: "/search" },
      { kind: "link", actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" },
    ]);
  });
});

describe("toMapLayers on the tab lens", () => {
  const route: LayerSpec = {
    id: "route",
    label: { ko: "노선" },
    defaultVisibleWhen: { kind: "never" },
    userConfigurable: true,
    endpoint: "/map/overlays/transit",
    chipGroupId: null,
  };

  it("sends the tabs a layer states, and leaves the key out when it states none", () => {
    // Act
    const [stated, unstated] = toMapLayers([{ ...route, tabs: ["transit"] }, route], "ko");

    // Assert
    expect(stated?.tabs).toEqual(["transit"]);
    expect(unstated).not.toHaveProperty("tabs");
  });
});

describe("toMapChips on the tab lens", () => {
  const routes: MapChipSpec = {
    id: "routes",
    emoji: "🚌",
    label: { ko: "노선" },
    action: { kind: "layers", layerIds: ["jongro02_route", "hssc_route"], camera: null },
    isReset: false,
    list: null,
  };

  it("sends a layers chip's layer ids and a null camera when the chip does not move it", () => {
    // Act
    const [chip] = toMapChips([routes], "ko");

    // Assert
    expect(chip?.action).toEqual({ kind: "layers", layerIds: ["jongro02_route", "hssc_route"], camera: null });
  });

  it("sends a layers chip's camera when it states one", () => {
    // Arrange
    const moving: MapChipSpec = { ...routes, action: { kind: "layers", layerIds: ["hssc_route"], camera } };

    // Act
    const [chip] = toMapChips([moving], "ko");

    // Assert
    expect(chip?.action).toEqual({ kind: "layers", layerIds: ["hssc_route"], camera });
  });

  it("sends tabs and opensIn when a chip states them, and leaves both keys out when it does not", () => {
    // Act
    const [stated, unstated] = toMapChips([{ ...routes, tabs: ["map", "transit"], opensIn: "transit" }, routes], "ko");

    // Assert
    expect(stated).toMatchObject({ tabs: ["map", "transit"], opensIn: "transit" });
    expect(unstated).not.toHaveProperty("tabs");
    expect(unstated).not.toHaveProperty("opensIn");
  });

  it("sends an empty tabs as an empty array, which puts the chip in no tab, rather than leaving the key out", () => {
    // Act
    const [chip] = toMapChips([{ ...routes, tabs: [] }], "ko");

    // Assert
    // An absent `tabs` means the map tab, so dropping the empty array would put the chip back there.
    expect(chip).toHaveProperty("tabs", []);
    expect(chip).not.toHaveProperty("opensIn");
  });
});

describe("toMapConfig", () => {
  it("labels both campuses in the request's language and carries the camera defaults", () => {
    // Act
    const body = toMapConfig({ lang: "en", styleId: undefined, layers: [], chips: [] });

    // Assert
    expect(body.campuses.map((c) => [c.id, c.label, c.defaultBearing])).toEqual([
      ["hssc", "HSSC", 0],
      ["nsc", "NSC", 6],
    ]);
    expect(body.cameraDefaults).toEqual({
      markerFocus: { zoom: 17.5, tilt: 0, bearing: 0, durationMs: 500 },
      campusFocus: { durationMs: 500 },
    });
    expect(JSON.stringify(body.naver)).toBe("{}");
  });
});

describe("the reset chip on the wire", () => {
  it("survives the projection to the wire, for every language", () => {
    // Act & Assert
    for (const lang of LANGS) {
      const wire = toMapChips(LAYER_SET.servedChipSpecs(CONFIG), lang);
      expect(wire.filter((chip) => chip.isReset)).toHaveLength(1);
      expect(wire.find((chip) => chip.isReset)!.id).toBe("eskara-2026_all");
    }
  });
});

describe("the chips /map/config serves", () => {
  it("serves only the base chips when no festival is live", () => {
    // Act
    const chips = toMapChips(LAYER_SET.servedChipSpecs(null), "ko");

    // Assert
    expect(chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("adds the festival row while one is live: reset chip plus every authored chip", () => {
    // Act
    const chips = toMapChips(LAYER_SET.servedChipSpecs(CONFIG), "ko");

    // Assert
    expect(chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
    expect(chips[BASE_CHIPS.length]!.id).toBe("eskara-2026_all");
  });

  it.each(LANGS)("resolves every chip label in %s through the one I18n resolver", (lang) => {
    // Act
    const chips = toMapChips(LAYER_SET.servedChipSpecs(CONFIG), lang);

    // Assert
    for (const spec of SERVED) {
      const chip = chips.find((c) => c.id === spec.id)!;
      expect(chip.label).toBe(pick(spec.label, lang));
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every chip an emoji icon and a known action kind", () => {
    // Act & Assert
    for (const chip of toMapChips(LAYER_SET.servedChipSpecs(CONFIG), "ko")) {
      expect(chip.icon).toEqual({ kind: "emoji", emoji: expect.any(String) });
      expect(["webview", "focus", "link", "layers"]).toContain(chip.action.kind);
    }
  });
});

describe("focus actions", () => {
  const focusChips = () =>
    toMapChips(LAYER_SET.servedChipSpecs(CONFIG), "ko").filter((chip) => chip.action.kind === "focus");

  it("name layers that all resolve to one non-null chip group", () => {
    // Act
    const chips = focusChips();

    // Assert
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      if (chip.action.kind !== "focus") continue;
      const groups = new Set(
        chip.action.layerIds.map((layerId) => chipGroupOf(layerId)),
      );
      expect(groups.size).toBe(1);
      const group = [...groups][0];
      // undefined = not a layer at all; null = a layer no chip may touch.
      expect(group).toBe(CONFIG.layerSetId);
    }
  });

  it("send a complete camera, coordinates inside Korea", () => {
    // Act & Assert
    for (const chip of focusChips()) {
      if (chip.action.kind !== "focus") continue;
      const { lat, lng, zoom, tilt, bearing, durationMs } = chip.action.camera;
      // A [lng, lat] swap lands in the ocean, so the bound is worth stating.
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      expect(lat).toBeGreaterThan(33);
      expect(lng).toBeGreaterThan(124);
      expect(zoom).toBeGreaterThan(0);
      expect(tilt).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(durationMs).toBeGreaterThan(0);
    }
  });
});

describe("webview actions", () => {
  it("resolves every webview URL to an absolute one on our own origin", () => {
    // Act
    const chips = toMapChips(LAYER_SET.servedChipSpecs(CONFIG), "ko").filter(
      (chip) => chip.action.kind === "webview",
    );

    // Assert
    // None ship today — lost and found was the only one. The count is asserted rather
    // than the loop simply left to run empty, so this cannot rot into a
    // silently vacuous test: adding a webview chip fails here, and the
    // assertions below are already waiting for it. The rule itself lives in
    // toWebviewUrl and is unit-tested in __tests__/nest/infra/webview-url.test.ts.
    expect(chips).toHaveLength(0);

    for (const chip of chips) {
      if (chip.action.kind !== "webview") continue;
      expect(chip.action.url.startsWith(`${WEBVIEW_ORIGIN}/`)).toBe(true);
      expect(new URL(chip.action.url).origin).toBe(WEBVIEW_ORIGIN);
    }
  });
});
