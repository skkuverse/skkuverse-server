/**
 * The layer-set checks that span more than one value: a facet option's window
 * (instants with an offset, from before until, none on a tag option, days that
 * do not overlap) and the references between layers, facets, lists, chips and
 * the category table, each reported with the path the loader prints.
 */
import { assertValidConfig } from "./map-layer-set.config";
import { crossReferenceIssue, optionIssues } from "./map-layer-set.rules";
import type { LayerSet } from "./map-layer-set.schema";
import fs from "fs";
import path from "path";

const CONFIG: LayerSet = assertValidConfig(JSON.parse(fs.readFileSync(path.join(__dirname, "eskara-2026.json"), "utf8")));

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
