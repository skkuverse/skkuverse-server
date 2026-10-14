/**
 * The layer-set file's shape: the shipped file parses, every top-level field
 * is required, and the defaults a field left out reads as.
 */
import fs from "fs";
import path from "path";
import { layerSetFile, toOptionWindow } from "./map-layer-set.schema";

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
