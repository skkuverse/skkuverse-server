/**
 * The /map/config body: campuses labelled in the request's language, layers
 * with their label resolved and every other field passed through in order,
 * chips with a resolved label, an absolute web view URL and their list, and
 * the camera defaults. The chip row is also projected as /map/config serves
 * it, base chips plus the live festival's from the real `eskara-2026.json`,
 * read through MapLayerSetService as the config service reads it.
 */
import type { Clock } from "../../infra/clock";
import { pick } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import type { EventMapConfig } from "../layer-set/map-layer-set.schema";
import { MapLayerSetService } from "../layer-set/map-layer-set.service";
import type { MapChipSpec } from "../layer-set/map-layer-set.types";
import { BASE_LAYERS } from "../map.constants";
import type { MapRepository } from "../map.repository";
import { chipGroupOf } from "../map.rules";
import { toMapChips, toMapConfig, toMapLayers } from "./map-config.mapper";
import { FakeMapRepository } from "../../../__tests__/helpers/fakes/map/map.repository.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import { shippedLayerSet } from "../../../__tests__/helpers/map/shipped-layer-set";

const CLOCK: Clock = { now: () => new Date("2026-10-01T03:00:00.000Z") };
const LAYER_SET = new MapLayerSetService(asReal<MapRepository>(new FakeMapRepository()), CLOCK);

/** The chips /map/config serves for a live festival, or none. */
const getChips = (lang: SupportedLang, event: EventMapConfig | null) => toMapChips(LAYER_SET.servedChipSpecs(event), lang);

const LANGS = ["ko", "en", "zh"] as const;
const CONFIG = shippedLayerSet();
const BASE_CHIPS = LAYER_SET.servedChipSpecs(null);

/** What /map/config serves while this festival is live. */
const CATALOGUE = LAYER_SET.servedLayerSpecs(CONFIG);
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
      const wire = getChips(lang, CONFIG);
      expect(wire.filter((chip) => chip.isReset)).toHaveLength(1);
      expect(wire.find((chip) => chip.isReset)!.id).toBe("eskara-2026_all");
    }
  });
});

describe("the chips /map/config serves", () => {
  it("serves only the base chips when no festival is live", () => {
    // Act
    const chips = getChips("ko", null);

    // Assert
    expect(chips.map((c) => c.id)).toEqual(BASE_CHIPS.map((c) => c.id));
  });

  it("adds the festival row while one is live: reset chip plus every authored chip", () => {
    // Act
    const chips = getChips("ko", CONFIG);

    // Assert
    expect(chips).toHaveLength(BASE_CHIPS.length + 1 + CONFIG.chips.length);
    expect(chips[BASE_CHIPS.length]!.id).toBe("eskara-2026_all");
  });

  it.each(LANGS)("resolves every chip label in %s through the one I18n resolver", (lang) => {
    // Act
    const chips = getChips(lang, CONFIG);

    // Assert
    for (const spec of SERVED) {
      const chip = chips.find((c) => c.id === spec.id)!;
      expect(chip.label).toBe(pick(spec.label, lang));
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("gives every chip an emoji icon and a known action kind", () => {
    // Act & Assert
    for (const chip of getChips("ko", CONFIG)) {
      expect(chip.icon).toEqual({ kind: "emoji", emoji: expect.any(String) });
      expect(["webview", "focus"]).toContain(chip.action.kind);
    }
  });
});

describe("focus actions", () => {
  const focusChips = () =>
    getChips("ko", CONFIG).filter((chip) => chip.action.kind === "focus");

  it("name layers that all resolve to one non-null chip group", () => {
    // Act
    const chips = focusChips();

    // Assert
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      if (chip.action.kind !== "focus") continue;
      const groups = new Set(
        chip.action.layerIds.map((layerId) => chipGroupOf(CATALOGUE, layerId)),
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
    const chips = getChips("ko", CONFIG).filter(
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
