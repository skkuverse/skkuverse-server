/**
 * The layer set's projections: festival layers and chips as the specs
 * /map/config serves (fresh objects, never the frozen config's own), a facet
 * option's window as instants, and a zod issue in the words and path the
 * loader has always printed. The chip row read from the real
 * `eskara-2026.json` is checked against the chip rules, and the reset chip,
 * authored nowhere, is synthesised from the festival's name, emoji and the
 * layers that come on by themselves, so it cannot drift from the layer list.
 */
import fs from "fs";
import path from "path";
import { parseLayerSetFile } from "./map-layer-set.config";
import { BASE_LAYERS } from "../map.constants";
import { BASE_CHIPS, EVENT_LAYER_STYLE, EVENT_SHAPE_STYLE } from "./map-layer-set.constants";
import { assertValidChipSpecs, validateChipSpecs } from "./map-layer-set.rules";
import { eventChipSpecs, eventLayerSpecs, resetChip } from "./map-layer-set.mapper";
import type { LayerSet } from "./map-layer-set.schema";

const CONFIG = parseLayerSetFile(JSON.parse(fs.readFileSync(path.join(__dirname, "eskara-2026.json"), "utf8")));

/** What /map/config serves while this festival is live. */
const CATALOGUE = [...BASE_LAYERS, ...eventLayerSpecs(CONFIG)];
const SERVED = [...BASE_CHIPS, ...eventChipSpecs(CONFIG)];

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

describe("the event styles eventLayerSpecs stamps on every festival layer", () => {
  it("draw no outline and send no shape", () => {
    // Act & Assert
    // Named apart from the wire tests in map-config.service.spec.ts: these constants
    // are where a border or a shape comes back for every festival layer at once, and a
    // failure here says which constant was edited instead of pointing at a projected
    // response object. Opting ONE layer out stays legal, on its own style literal.
    expect(EVENT_SHAPE_STYLE.outlineWidth).toBe(0);
    expect(Object.keys(EVENT_LAYER_STYLE)).not.toContain("shape");
    expect(Object.keys(EVENT_SHAPE_STYLE)).not.toContain("shape");
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

describe("chip lists", () => {
  it("ships at least one festival chip", () => {
    // Act & Assert
    // Guards every `for (const chip of ...)` below against vacuous truth.
    expect(eventChipSpecs(CONFIG).length).toBeGreaterThan(0);
  });

  it("serves the four permanent link chips off-season, in the row's order", () => {
    // Act & Assert
    // The four buttons that left the campus sheet for the chip row. Asserting the
    // whole row means adding, dropping or reordering a permanent chip has to be deliberate.
    expect(BASE_CHIPS).toEqual([
      {
        id: "building_map",
        emoji: "🏢",
        label: { ko: "건물지도", en: "Building Map", zh: "建筑地图" },
        action: { kind: "link", actionType: "route", actionValue: "/map/hssc" },
        isReset: false,
        list: null,
      },
      {
        id: "building_code",
        emoji: "🔢",
        label: { ko: "건물코드", en: "Building Code", zh: "建筑编号" },
        action: { kind: "link", actionType: "route", actionValue: "/search" },
        isReset: false,
        list: null,
      },
      {
        id: "lost_found",
        emoji: "🧳",
        label: { ko: "분실물", en: "Lost & Found", zh: "失物招领" },
        action: { kind: "link", actionType: "webview", actionValue: "/skku/lostandfound" },
        isReset: false,
        list: null,
      },
      {
        id: "inquiry",
        emoji: "💬",
        label: { ko: "문의하기", en: "Inquiry", zh: "咨询" },
        action: { kind: "link", actionType: "external", actionValue: "https://pf.kakao.com/_cjxexdG/chat" },
        isReset: false,
        list: null,
      },
    ]);
  });

  it("has no duplicate chip id across the served row", () => {
    // Arrange
    const ids = SERVED.map((chip) => chip.id);

    // Act & Assert
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the reset chip", () => {
  it("comes first, and carries the festival's own name and emoji", () => {
    // Act
    const [first] = eventChipSpecs(CONFIG);

    // Assert
    expect(first).toEqual(resetChip(CONFIG));
    expect(first!.id).toBe("eskara-2026_all");
    expect(first!.emoji).toBe(CONFIG.emoji);
    expect(first!.label).toEqual(CONFIG.name);
  });

  it("scopes itself to the layers that come on by themselves", () => {
    // Act
    const all = resetChip(CONFIG);

    // Assert
    if (all.action.kind !== "focus") throw new Error("expected a focus chip");
    // Always-on AND scheduled: a scheduled layer comes on by itself when its
    // window opens, so it belongs to the set the reset chip is scoped to. Only
    // an opt-in layer is outside it.
    const expected = CONFIG.layers
      .filter((l) => l.defaultVisibleWhen.kind !== "never")
      .map((l) => l.id);
    expect([...all.action.layerIds].sort()).toEqual([...expected].sort());

    // The bug this guards: naming every festival layer makes the reset chip
    // scope reach a layer that ships opt-in. The shipped config has such a
    // layer, so the guard is not vacuous.
    const optIn = CONFIG.layers.find((l) => l.defaultVisibleWhen.kind === "never");
    expect(optIn).toBeDefined();
    expect(all.action.layerIds).not.toContain(optIn!.id);
  });

  it("is the one chip that says outright it is a reset", () => {
    // `layerIds` still declares the GROUP the chip is scoped to — that is how
    // any chip does it, and how a second festival's reset chip would stay off
    // this one's layers. What it can no longer do is describe the resulting
    // view, because a scheduled layer's default depends on the time of day.
    // `isReset` carries that meaning instead: stop narrowing, do not "show
    // these".
    // Act & Assert
    expect(resetChip(CONFIG).isReset).toBe(true);

    const authored = eventChipSpecs(CONFIG).slice(1);
    expect(authored.length).toBeGreaterThan(0);
    expect(authored.every((chip) => chip.isReset === false)).toBe(true);
  });

  it("is a fresh object per call — the config is shared across requests", () => {
    // Act
    const a = resetChip(CONFIG);
    const b = resetChip(CONFIG);

    // Assert
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    if (a.action.kind !== "focus" || b.action.kind !== "focus") throw new Error("focus");
    expect(a.action.camera).not.toBe(CONFIG.camera);
    expect(a.action.layerIds).not.toBe(b.action.layerIds);
  });
});

describe("authored chips", () => {
  it("inherit the label of their one layer when none is authored", () => {
    // Arrange
    // The shipped config authors every label (its chips read singular where the
    // layers read plural), so the convenience is exercised on a synthetic one.
    const unlabelled: LayerSet = {
      ...CONFIG,
      chips: [{ id: "x", emoji: "🍻", layerIds: ["eskara26_bar"] }],
    };
    // Act
    const spec = eventChipSpecs(unlabelled).find((c) => c.id === "x")!;

    // Assert
    const layer = CONFIG.layers.find((l) => l.id === "eskara26_bar")!;
    expect(spec.label).toEqual(layer.label);
    expect(spec.label).not.toBe(layer.label);
  });

  it("keep an authored label over the layer's", () => {
    // Arrange
    const withLabel: LayerSet = {
      ...CONFIG,
      chips: [{ id: "x", emoji: "🍻", layerIds: ["eskara26_bar"], label: { ko: "야간 주점" } }],
    };
    // Act
    const spec = eventChipSpecs(withLabel).find((c) => c.id === "x")!;

    // Assert
    expect(spec.label).toEqual({ ko: "야간 주점" });
  });

  it("each fly to their own camera, or the config's when they author none", () => {
    // Arrange
    // This test used to read "all point the camera where the config says" —
    // every chip shared one camera. Chips may now carry their own, so the rule is
    // per chip: the authored camera wins, the config's is the fallback, and the
    // reset chip (authored nowhere) is always the config's.
    const authoredById = new Map(CONFIG.chips.map((c) => [c.id, c]));

    // Act & Assert
    for (const chip of eventChipSpecs(CONFIG)) {
      if (chip.action.kind !== "focus") throw new Error("expected focus");
      const authored = authoredById.get(chip.id);
      expect(chip.action.camera).toEqual(authored?.camera ?? CONFIG.camera);
    }
  });

  it("fall back to the config's camera when a chip authors none", () => {
    // Arrange
    // The shipped config authors a camera on every chip, so the fallback is
    // exercised on a synthetic one — it is what makes the field additive for a
    // config written before it existed.
    const bare: LayerSet = {
      ...CONFIG,
      chips: [{ id: "x", emoji: "🍻", layerIds: ["eskara26_bar"] }],
    };
    // Act
    const spec = eventChipSpecs(bare).find((c) => c.id === "x")!;

    // Assert
    if (spec.action.kind !== "focus") throw new Error("expected focus");
    expect(spec.action.camera).toEqual(CONFIG.camera);
    // A copy, never the config's own frozen object.
    expect(spec.action.camera).not.toBe(CONFIG.camera);
  });

  it("copy an authored camera rather than hand it out by reference", () => {
    // Arrange
    const withCamera: LayerSet = {
      ...CONFIG,
      chips: [
        {
          id: "x",
          emoji: "🍻",
          layerIds: ["eskara26_bar"],
          camera: { ...CONFIG.camera, zoom: 15 },
        },
      ],
    };
    const authored = withCamera.chips[0]!.camera!;

    // Act
    const spec = eventChipSpecs(withCamera).find((c) => c.id === "x")!;

    // Assert
    if (spec.action.kind !== "focus") throw new Error("expected focus");
    expect(spec.action.camera).toEqual(authored);
    // The config is shared across every request, so a response must never
    // alias it: a caller mutating one reply would move every later one.
    expect(spec.action.camera).not.toBe(authored);
  });
});

describe("the served chip row", () => {
  it("passes the chip rules: validateChipSpecs reports nothing", () => {
    // Act & Assert
    expect(validateChipSpecs(SERVED, CATALOGUE)).toEqual([]);
  });

  it("passes assertValidChipSpecs, which the boot path runs", () => {
    // Act & Assert
    expect(() => assertValidChipSpecs(SERVED, CATALOGUE)).not.toThrow();
  });
});
