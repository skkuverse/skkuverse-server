/**
 * The /map/config body: campuses labelled in the request's language, layers
 * with their label resolved and every other field passed through in order,
 * chips with a resolved label, an absolute web view URL and their list, and
 * the camera defaults.
 */
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { MapChipSpec } from "../layer-set/map-layer-set.types";
import { BASE_LAYERS } from "../map.constants";
import { toMapChips, toMapConfig, toMapLayers } from "./map-config.mapper";

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
