/**
 * The chip contract served inside GET /map/config: the chip validator and
 * chipGroupOf (map.rules.ts), the festival's chip specs and reset chip
 * (layer-set/map-layer-set.mapper.ts), and their projection to the wire
 * (config/map-config.mapper.ts).
 *
 * Two kinds of assertion here, and they fail for different reasons:
 *
 *  - The SHIPPED row — base chips plus the live festival's, read from the real
 *    `eskara-2026.json` — is checked against the same rules the validator
 *    enforces. Those can only fail if someone edits a chip or the config, and
 *    they fail in CI rather than at deploy.
 *  - `validateChipSpecs` is exercised with deliberately broken input, because
 *    the shipped row being correct proves nothing about whether a wrong one
 *    would be caught.
 *
 * The reset chip is the one worth reading closely: it is not authored anywhere.
 * The server synthesises it from the festival's `name`, `emoji` and the layers
 * that come on by themselves, so it cannot drift from the layer list.
 */

import { pick } from "../infra/i18n";
import { WEBVIEW_ORIGIN } from "../infra/origins";
import type { SupportedLang } from "../infra/types";
import { toMapChips } from "./config/map-config.mapper";
import { getLayerSetConfig } from "./layer-set/map-layer-set.config";
import { BASE_CHIPS } from "./layer-set/map-layer-set.constants";
import { eventChipSpecs, eventLayerSpecs, resetChip } from "./layer-set/map-layer-set.mapper";
import type { EventMapConfig } from "./layer-set/map-layer-set.schema";
import type { MapChipSpec } from "./layer-set/map-layer-set.types";
import { BASE_LAYERS } from "./map.constants";
import { assertValidChipSpecs, chipGroupOf, validateChipSpecs } from "./map.rules";

/** The chips /map/config serves for a live festival, or none: the projection the old getChips made. */
const getChips = (lang: SupportedLang, event: EventMapConfig | null) =>
  toMapChips(event ? [...BASE_CHIPS, ...eventChipSpecs(event)] : BASE_CHIPS, lang);

const LANGS = ["ko", "en", "zh"] as const;

const loaded = getLayerSetConfig("eskara-2026");
if (!loaded?.config) throw new Error(`eskara-2026 failed to load: ${loaded?.error}`);
const CONFIG: EventMapConfig = loaded.config;

/** What /map/config serves while this festival is live. */
const CATALOGUE = [...BASE_LAYERS, ...eventLayerSpecs(CONFIG)];
const SERVED = [...BASE_CHIPS, ...eventChipSpecs(CONFIG)];

/** Broken input has to bypass the type on purpose. */
const asSpecs = (specs: unknown): MapChipSpec[] => specs as MapChipSpec[];

describe("chip lists", () => {
  it("ships at least one festival chip", () => {
    // Act & Assert
    // Guards every `for (const chip of ...)` below against vacuous truth.
    expect(eventChipSpecs(CONFIG).length).toBeGreaterThan(0);
  });

  it("serves no chip row at all off-season", () => {
    // BASE_CHIPS being empty is a decision, not an oversight — lost and found was
    // removed and the campus SDUI still carries that action. Asserting the
    // count means putting a permanent chip back has to be deliberate.
    // Act & Assert
    expect(BASE_CHIPS).toHaveLength(0);
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

    // And it survives the projection to the wire, for every language.
    for (const lang of LANGS) {
      const wire = getChips(lang, CONFIG);
      expect(wire.filter((chip) => chip.isReset)).toHaveLength(1);
      expect(wire.find((chip) => chip.isReset)!.id).toBe("eskara-2026_all");
    }
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
    const unlabelled: EventMapConfig = {
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
    const withLabel: EventMapConfig = {
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
    const bare: EventMapConfig = {
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
    const withCamera: EventMapConfig = {
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

describe("validateChipSpecs — every rule, reported together", () => {
  const focusSpec = (layerIds: readonly string[], id = "test_chip"): unknown => ({
    id,
    emoji: "\u{1F3AF}",
    label: { ko: "테스트" },
    action: {
      kind: "focus",
      camera: { lat: 37.29, lng: 126.97, zoom: 17, tilt: 0, bearing: 0, durationMs: 500 },
      layerIds,
    },
  });

  it("accepts the row this server actually serves", () => {
    // Act & Assert
    expect(validateChipSpecs(SERVED, CATALOGUE)).toEqual([]);
  });

  it("rejects a layer id that is not a layer", () => {
    // Act
    const errors = validateChipSpecs(asSpecs([focusSpec(["eskara26_ghost"])]), CATALOGUE);

    // Assert
    expect(errors).toEqual([expect.stringMatching(/eskara26_ghost.*is not a layer/)]);
  });

  it("rejects a layer no chip may reach", () => {
    // Act
    // building_numbers is chipGroupId: null — the whole point of the flag.
    const errors = validateChipSpecs(asSpecs([focusSpec(["building_numbers"])]), CATALOGUE);

    // Assert
    expect(errors).toEqual([expect.stringMatching(/building_numbers.*chipGroupId null/)]);
  });

  it("rejects layer ids straddling two chip groups", () => {
    // Nothing shares a group with a festival layer today, so the cross-group
    // case is built by pairing one with a null-group layer: the null rule fires
    // for the building layer. Once a second group exists the straddle message
    // must name it specifically.
    // Act
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_booth", "building_labels"])]),
      CATALOGUE,
    );

    // Assert
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a webview URL that does not land on our origin", () => {
    // Act
    const errors = validateChipSpecs(
      asSpecs([
        { id: "evil", emoji: "\u{1F6A9}", label: { ko: "x" }, action: { kind: "webview", url: "https://evil.com/x" } },
      ]),
      CATALOGUE,
    );

    // Assert
    expect(errors).toEqual([expect.stringMatching(/evil\.com/)]);
  });

  it("rejects a webview URL whose fragment never reaches the origin", () => {
    // `/eskara#/entry` keeps a real pathname, so an origin-and-path check waves
    // it through while the user lands on the wrong page. toWebviewUrl is the
    // one place that rule lives; this proves chips go through it.
    // Act
    const errors = validateChipSpecs(
      asSpecs([
        { id: "fragment", emoji: "\u{1F6A9}", label: { ko: "x" }, action: { kind: "webview", url: "/eskara#/entry" } },
      ]),
      CATALOGUE,
    );

    // Assert
    expect(errors).toEqual([expect.stringMatching(/eskara/)]);
  });

  it("rejects a duplicate chip id", () => {
    // Act
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_booth"]), focusSpec(["eskara26_bar"])]),
      CATALOGUE,
    );

    // Assert
    expect(errors).toEqual([expect.stringMatching(/duplicate chip id "test_chip"/)]);
  });

  it("accumulates rather than stopping at the first problem", () => {
    // Act
    // One boot per mistake is the failure mode this exists to avoid.
    const errors = validateChipSpecs(
      asSpecs([focusSpec(["eskara26_ghost"], "a"), focusSpec(["building_numbers"], "b")]),
      CATALOGUE,
    );

    // Assert
    expect(errors).toHaveLength(2);
  });

  it("assertValidChipSpecs throws the FATAL form the boot path expects", () => {
    // Act & Assert
    expect(() => assertValidChipSpecs(asSpecs([focusSpec(["nope"])]), CATALOGUE)).toThrow(
      /^FATAL \[map chips\]/,
    );
    expect(() => assertValidChipSpecs(SERVED, CATALOGUE)).not.toThrow();
  });
});
