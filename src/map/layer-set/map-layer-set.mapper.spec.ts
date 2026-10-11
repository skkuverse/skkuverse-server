/**
 * The layer set's projections: festival layers and chips as the specs
 * /map/config serves (fresh objects, never the frozen config's own), a facet
 * option's window as instants, and a zod issue in the words and path the
 * loader has always printed.
 */
import fs from "fs";
import path from "path";
import { assertValidConfig } from "./map-layer-set.config";
import { eventChipSpecs, eventLayerSpecs, resetChip, toConfigMessage, toConfigWords, toOptionWindow } from "./map-layer-set.mapper";

const CONFIG = assertValidConfig(JSON.parse(fs.readFileSync(path.join(__dirname, "eskara-2026.json"), "utf8")));

describe("eventLayerSpecs", () => {
  it("serves every festival layer as user-configurable, on the event endpoint, in the layer set's chip group", () => {
    // Act
    const specs = eventLayerSpecs(CONFIG);

    // Assert
    expect(specs.map((s) => s.id)).toEqual(CONFIG.layers.map((l) => l.id));
    expect(specs.every((s) => s.userConfigurable && s.endpoint === "/map/overlays/event" && s.chipGroupId === "eskara-2026")).toBe(true);
  });

  it("copies a scheduled window rather than sharing the config's", () => {
    // Arrange
    const scheduled = CONFIG.layers.findIndex((l) => l.defaultVisibleWhen.kind === "scheduled");

    // Act
    const served = eventLayerSpecs(CONFIG)[scheduled]?.defaultVisibleWhen;

    // Assert
    expect(served).toEqual(CONFIG.layers[scheduled]?.defaultVisibleWhen);
    expect(served).not.toBe(CONFIG.layers[scheduled]?.defaultVisibleWhen);
  });
});

describe("resetChip and eventChipSpecs", () => {
  it("puts the synthesised reset chip first, scoped to the layers that come on by themselves", () => {
    // Act
    const [first, ...authored] = eventChipSpecs(CONFIG);

    // Assert
    expect(first).toEqual(resetChip(CONFIG));
    expect(first?.isReset).toBe(true);
    expect(authored.map((c) => c.id)).toEqual(CONFIG.chips.map((c) => c.id));
  });

  it("names a single-layer chip after its layer when it has no label of its own", () => {
    // Arrange
    const chip = CONFIG.chips.find((c) => c.layerIds.length === 1 && c.label === undefined);

    // Act
    const spec = eventChipSpecs(CONFIG).find((c) => c.id === chip?.id);

    // Assert
    expect(spec?.label).toEqual(CONFIG.layers.find((l) => l.id === chip?.layerIds[0])?.label);
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

describe("toConfigWords and toConfigMessage", () => {
  it.each([
    [{ code: "invalid_type", expected: "object", input: undefined, path: [] }, "must be an object"],
    [{ code: "invalid_type", expected: "record", input: [], path: [] }, "must be an object"],
    [{ code: "invalid_type", expected: "number", input: "1", path: [] }, "must be a finite number"],
    [{ code: "invalid_value", values: ["hours", "tag"], input: "date", path: [] }, "must be one of [hours, tag]"],
    [{ code: "invalid_union", options: ["always", "never", "scheduled"], errors: [], input: {}, path: [] }, "must be one of [always, never, scheduled]"],
    [{ code: "custom", input: 1, path: [] }, undefined],
  ])("words %j as %p", (issue, words) => {
    // Act & Assert
    expect(toConfigWords(issue as never)).toBe(words);
  });

  it("prints an index in brackets and a category key quoted", () => {
    // Act & Assert
    expect(toConfigMessage({ path: ["layers", 0, "label", "ko"], message: "must be a non-empty string" })).toBe(
      "config.layers[0].label.ko must be a non-empty string",
    );
    expect(toConfigMessage({ path: ["itemDefaults", "byCategory", "bar", "pinPriority"], message: "x" })).toBe(
      'config.itemDefaults.byCategory["bar"].pinPriority x',
    );
    expect(toConfigMessage({ path: [], message: "must be an object" })).toBe("config must be an object");
  });
});
