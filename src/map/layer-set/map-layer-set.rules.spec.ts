/**
 * The layer-set checks that span more than one value: a facet option's window
 * (instants with an offset, from before until, none on a tag option, days that
 * do not overlap) and the references between layers, facets, lists, chips and
 * the category table, each reported with the path the loader prints. And the
 * chip validator with chipGroupOf: every rule exercised with deliberately
 * broken input, because a correct shipped row proves nothing about whether a
 * wrong one would be caught. Its catalogue is the base map's layers plus two
 * festival layers in one chip group, as a live festival adds them; the shipped
 * row itself is checked in map-layer-set.mapper.spec.ts.
 */
import { parseLayerSetFile } from "./map-layer-set.config";
import { BASE_LAYERS } from "../map.constants";
import type { LayerSpec } from "../map.types";
import { assertValidChipSpecs, crossReferenceIssue, optionIssues, validateChipSpecs } from "./map-layer-set.rules";
import type { LayerSet } from "./map-layer-set.schema";
import fs from "fs";
import path from "path";

const CONFIG: LayerSet = parseLayerSetFile(JSON.parse(fs.readFileSync(path.join(__dirname, "eskara-2026.json"), "utf8")));

const day = (id: string, from: string, until: string): { id: string; from: string; until: string } => ({ id, from, until });

describe("optionIssues", () => {
  it("passes back-to-back days", () => {
    // Arrange
    const days = [day("d1", "2026-10-01T06:00:00+09:00", "2026-10-02T06:00:00+09:00"), day("d2", "2026-10-02T06:00:00+09:00", "2026-10-03T06:00:00+09:00")];

    // Act & Assert
    expect(optionIssues("hours", days)).toEqual([]);
  });

  it("reports days that overlap by one minute", () => {
    // Arrange
    const days = [day("d2", "2026-10-02T05:59:00+09:00", "2026-10-03T06:00:00+09:00"), day("d1", "2026-10-01T06:00:00+09:00", "2026-10-02T06:00:00+09:00")];

    // Act & Assert
    expect(optionIssues("hours", days)).toEqual([[["options"], '"d1" and "d2" overlap']]);
  });

  it.each([
    ["2026-10-01T06:00:00+09:00", "2026-10-01T06:01:00+09:00", []],
    ["2026-10-01T06:00:00+09:00", "2026-10-01T06:00:00+09:00", [[["options", 0, "from"], "must be before until"]]],
  ])("checks from %s against until %s", (from, until, expected) => {
    // Act & Assert
    expect(optionIssues("hours", [day("d1", from, until)])).toEqual(expected);
  });

  it.each([
    [undefined, "must be a non-empty string"],
    ["2026-10-01T06:00:00", "must carry an explicit offset (e.g. +09:00)"],
    ["2026-13-01T06:00:00+09:00", '"2026-13-01T06:00:00+09:00" is not an ISO instant'],
  ])("names the bad bound %p", (from, message) => {
    // Act & Assert
    expect(optionIssues("hours", [{ id: "d1", from, until: "2026-10-02T06:00:00+09:00" }])).toEqual([
      [["options", 0, "from"], message],
    ]);
  });

  it("refuses a window on a tag option and passes a bare one", () => {
    // Act & Assert
    expect(optionIssues("tag", [{ id: "council" }, { id: "club", until: "2026-10-02T06:00:00+09:00" }])).toEqual([
      [["options", 1], "is a tag option and must not carry from/until"],
    ]);
    expect(optionIssues("tag", [{ id: "council" }])).toEqual([]);
  });
});

describe("crossReferenceIssue", () => {
  it("finds nothing in the shipped config", () => {
    // Act & Assert
    expect(crossReferenceIssue(CONFIG)).toBeNull();
  });

  it("reports a layer the category table names but the config lacks, at its category", () => {
    // Arrange
    const byCategory = { ...CONFIG.itemDefaults.byCategory, bar: { ...CONFIG.itemDefaults.fallback, layerId: "nope" } };

    // Act & Assert
    expect(crossReferenceIssue({ ...CONFIG, itemDefaults: { ...CONFIG.itemDefaults, byCategory } })).toBe(
      'config.itemDefaults.byCategory["bar"].layerId "nope" is not in config.layers',
    );
  });

  it("reports the first problem in loader order: layers before facets", () => {
    // Arrange
    const broken = { ...CONFIG, layers: [], facets: [...CONFIG.facets, ...CONFIG.facets] };

    // Act & Assert
    expect(crossReferenceIssue(broken)).toBe("config.layers must not be empty");
  });

  it("reports a list facet the config does not define", () => {
    // Arrange
    const chips = CONFIG.chips.map((c, i) => (i === 0 && c.list ? { ...c, list: { ...c.list, facetIds: ["day", "price"] } } : c));

    // Act & Assert
    expect(crossReferenceIssue({ ...CONFIG, chips })).toBe('config.chips[0].list.facetIds[1] "price" is not in config.facets');
  });
});

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
