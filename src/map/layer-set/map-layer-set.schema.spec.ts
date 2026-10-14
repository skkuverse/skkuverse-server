/**
 * The layer-set file's shape: the shipped file parses, every top-level field
 * is required, and the defaults a field left out reads as.
 */
import fs from "fs";
import path from "path";
import { i18nTextFile, layerSetFile, mapCamera, toOptionWindow } from "./map-layer-set.schema";

const RAW = fs.readFileSync(path.join(__dirname, "eskara-2026.json"), "utf8");
const raw = (): Record<string, unknown> => JSON.parse(RAW);

describe("layerSetFile", () => {
  it("parses the shipped layer set", () => {
    // Act & Assert
    expect(layerSetFile.safeParse(raw()).success).toBe(true);
  });

  it.each(Object.keys(layerSetFile.shape))("refuses a file without %s", (field) => {
    // Arrange
    const file = raw();
    delete file[field];

    // Act & Assert
    expect(layerSetFile.safeParse(file).success).toBe(false);
  });

  it("reads absent defaults as always on, a pin, a tappable exact place", () => {
    // Arrange
    const file = raw() as { layers: Array<Record<string, unknown>>; itemDefaults: { fallback: Record<string, unknown> } };
    delete file.layers[0]?.defaultVisibleWhen;
    delete file.layers[0]?.markerStyle;
    file.itemDefaults.fallback = { layerId: file.itemDefaults.fallback.layerId, pinPriority: 0 };

    // Act
    const parsed = layerSetFile.parse(file);

    // Assert
    expect(parsed.layers[0]).toMatchObject({ defaultVisibleWhen: { kind: "always" }, markerStyle: "placeDot" });
    expect(parsed.itemDefaults.fallback).toMatchObject({ interactive: true, tapChip: null, locationAccuracy: "exact" });
  });
});

describe("toOptionWindow", () => {
  it("reads both bounds as instants, and gives a tag option none", () => {
    // Act & Assert
    expect(toOptionWindow("2026-10-01T06:00:00+09:00", "2026-10-02T06:00:00+09:00")).toEqual({
      from: new Date("2026-09-30T21:00:00.000Z"),
      until: new Date("2026-10-01T21:00:00.000Z"),
    });
    expect(toOptionWindow(undefined, undefined)).toBeNull();
  });
});

describe("i18nTextFile", () => {
  it("keeps ko and drops a null translation rather than sending it", () => {
    // Act
    const parsed = i18nTextFile.parse({ ko: "주점", en: null, zh: "酒馆" });

    // Assert
    expect(parsed).toEqual({ ko: "주점", zh: "酒馆" });
    expect(Object.keys(parsed)).toEqual(["ko", "zh"]);
  });

  it.each([{}, { ko: "" }, { ko: "  " }, { ko: "주점", en: "" }])("refuses %j", (text) => {
    // Act & Assert
    expect(i18nTextFile.safeParse(text).success).toBe(false);
  });
});

describe("mapCamera", () => {
  const camera = { lat: 37.295129, lng: 126.971234, zoom: 17.5, tilt: 0, bearing: 6, durationMs: 500 };

  it("keeps a camera's fields in the order the chips serve them", () => {
    // Act
    const parsed = mapCamera.parse({ durationMs: 500, bearing: 6, tilt: 0, zoom: 17.5, lng: 126.971234, lat: 37.295129 });

    // Assert
    expect(Object.keys(parsed)).toEqual(["lat", "lng", "zoom", "tilt", "bearing", "durationMs"]);
  });

  it.each([
    [90, true],
    [90.5, false],
    [-90.5, false],
  ])("treats latitude %d as in range: %s", (lat, inRange) => {
    // Act & Assert
    expect(mapCamera.safeParse({ ...camera, lat }).success).toBe(inRange);
  });

  it.each([
    [180, true],
    [180.5, false],
  ])("treats longitude %d as in range: %s", (lng, inRange) => {
    // Act & Assert
    expect(mapCamera.safeParse({ ...camera, lng }).success).toBe(inRange);
  });
});
