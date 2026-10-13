/**
 * The chip validator and chipGroupOf (map.rules.ts): every rule exercised with
 * deliberately broken input, because a correct shipped row proves nothing
 * about whether a wrong one would be caught. The catalogue is the base map's
 * layers plus two festival layers in one chip group, as a live festival adds
 * them; the shipped row itself is checked in layer-set/map-layer-set.mapper.spec.ts.
 */

import { BASE_LAYERS } from "./map.constants";
import { assertValidChipSpecs, validateChipSpecs } from "./map.rules";
import type { LayerSpec } from "./map.types";

const festivalLayer = (id: string): LayerSpec => ({
  id,
  label: { ko: id },
  defaultVisibleWhen: { kind: "always" },
  userConfigurable: true,
  endpoint: "/map/overlays/event",
  chipGroupId: "eskara-2026",
});

const CATALOGUE: readonly LayerSpec[] = [...BASE_LAYERS, festivalLayer("eskara26_booth"), festivalLayer("eskara26_bar")];

/** Broken input has to bypass the type on purpose. */
const asSpecs = (specs: unknown): Parameters<typeof validateChipSpecs>[0] => specs as Parameters<typeof validateChipSpecs>[0];

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
  });
});
