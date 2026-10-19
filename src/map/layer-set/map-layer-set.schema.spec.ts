/**
 * The layer-set shape and its checks. `layerSetFile`: revision 1 of the stored
 * set parses, every top-level field is required, and the defaults a field left
 * out reads as. `checkedLayerSet`: what the push and the read refuse in one
 * set, each issue at its path (move-editorial-datasets D6), every rejection the
 * deleted committed-file loader made ported here, and what an explicit null, a
 * false or an omitted optional field reads as. `layerSetsDataset`: the `map-layer-sets` dataset a push checks,
 * one set per `layerSetId`. `storedLayerSets`: the stored envelope the read
 * parses, each set on its own, so a bad or repeated set is left out with its
 * issues and the others serve (ADR 0010 D5's fail-soft, per set).
 */
import fs from "fs";
import path from "path";
import { checkedLayerSet, i18nTextFile, layerSetFile, layerSetsDataset, mapCamera, storedLayerSets, toOptionWindow } from "./map-layer-set.schema";

const FIXTURE = fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/map/fixtures/map-layer-sets.dataset.json"), "utf8");

/** The map-layer-sets fixture without its provenance note: revision 1 of the dataset. */
function fixtureDataset(): { layerSets: Array<Record<string, any>> } {
  const dataset = JSON.parse(FIXTURE) as { _about?: string; layerSets: Array<Record<string, any>> };
  delete dataset._about;
  return dataset;
}

/** A fresh deep copy of the fixture's one layer set, eskara-2026. */
function fixtureSet(): Record<string, any> {
  return fixtureDataset().layerSets[0]!;
}

/** Each issue `checkedLayerSet` finds in `set`, as its dotted path and message. */
function issuesOf(set: unknown): Array<{ path: string; message: string }> {
  const parsed = checkedLayerSet.safeParse(set);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

describe("layerSetFile", () => {
  it("parses revision 1 of the stored layer set", () => {
    // Act & Assert
    expect(layerSetFile.safeParse(fixtureSet()).success).toBe(true);
  });

  it.each(Object.keys(layerSetFile.shape))("refuses a file without %s", (field) => {
    // Arrange
    const file = fixtureSet();
    delete file[field];

    // Act & Assert
    expect(layerSetFile.safeParse(file).success).toBe(false);
  });

  it("reads absent defaults as always on, a pin, a tappable exact place", () => {
    // Arrange
    const file = fixtureSet() as { layers: Array<Record<string, unknown>>; itemDefaults: { fallback: Record<string, unknown> } };
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

type Mutation = (set: Record<string, any>) => void;
const chipById = (set: Record<string, any>, id: string): Record<string, any> => set.chips.find((c: { id: string }) => c.id === id);

/**
 * Every rejection of the deleted committed-file loader's spec, by its old title: the edit it made, the path the
 * issue now stands at, and the words of a message this repository writes (zod's own words for a type or enum are
 * not pinned).
 */
const PORTED_REJECTIONS: Array<[title: string, mutate: Mutation, path: string, message: RegExp | null]> = [
  ["rejects an itemDefaults entry pointing at a layer that does not exist", (s) => { s.itemDefaults.byCategory.bar.layerId = "nope"; }, "", /byCategory\["bar"\]\.layerId "nope" is not in config\.layers/],
  ["rejects a fallback pointing at a layer that does not exist", (s) => { s.itemDefaults.fallback.layerId = "nope"; }, "", /fallback\.layerId "nope" is not in config\.layers/],
  ["rejects a tapChip naming a chip that does not exist", (s) => { s.itemDefaults.byCategory.food_zone.tapChip = "nope"; }, "", /byCategory\["food_zone"\]\.tapChip "nope" is not in config\.chips/],
  ["rejects a locationAccuracy outside exact and area", (s) => { s.itemDefaults.byCategory.food.locationAccuracy = "approximate"; }, "itemDefaults.byCategory.food.locationAccuracy", null],
  ["rejects a tapChip on an inert category", (s) => { s.itemDefaults.byCategory.food_zone.interactive = false; }, "", /byCategory\["food_zone"\]\.tapChip is set on a category with interactive: false/],
  ["rejects a chip naming a layer that does not exist", (s) => { s.chips[0].layerIds = ["nope"]; }, "chips", /chip "eskara26_view_bar": "nope" is not a layer/],
  [
    "rejects a layer id the base map already uses",
    (s) => {
      s.layers[0].id = "building_numbers";
      for (const p of Object.values<{ layerId: string }>(s.itemDefaults.byCategory)) if (p.layerId === "eskara26_bar") p.layerId = "building_numbers";
      s.chips[0].layerIds = ["building_numbers"];
    },
    "",
    /config\.layers\[0\]\.id "building_numbers" collides with a base map layer/,
  ],
  ["rejects a chip id equal to the synthesised reset chip's", (s) => { s.chips[0].id = "eskara-2026_all"; }, "chips", /duplicate chip id "eskara-2026_all"/],
  ["requires the event's name", (s) => { delete s.name; }, "name", null],
  ["requires the event's emoji", (s) => { s.emoji = ""; }, "emoji", null],
  ["rejects duplicate layer ids", (s) => { s.layers.push({ ...s.layers[0] }); }, "", /config\.layers has a duplicate id "eskara26_bar"/],
  ["rejects an empty layers array", (s) => { s.layers = []; }, "", /config\.layers must not be empty/],
  ["rejects a layer set where nothing is on by default", (s) => { for (const layer of s.layers) layer.defaultVisibleWhen = { kind: "never" }; }, "", /at least one layer that is not defaultVisibleWhen\.kind "never"/],
  ["rejects a colour that is not bare six-digit hex", (s) => { s.layers[0].color = "#F04452"; }, "layers.0.color", /must be a 6-digit hex colour/],
  ["rejects duplicate chip ids", (s) => { s.chips.push({ ...s.chips[0] }); }, "chips", /duplicate chip id "eskara26_view_bar"/],
  ["rejects a chip naming no layers", (s) => { s.chips[0].layerIds = []; }, "chips.0.layerIds", /must not be empty/],
  ["refuses a label on a single-layer chip", (s) => { s.chips[0].label = { ko: "먹거리" }; }, "chips.0.label", /must be omitted for a single-layer chip/],
  ["requires a label on a multi-layer chip", (s) => { s.chips[0].layerIds = [s.layers[0].id, s.layers[1].id]; delete s.chips[0].label; }, "chips.0.label", /is required when layerIds names more than one layer/],
  ["rejects swapped camera coordinates", (s) => { s.camera = { ...s.camera, lat: 126.971234, lng: 37.295129 }; }, "camera.lat", /lat and lng may be swapped/],
  ["requires every camera motion field", (s) => { delete s.camera.durationMs; }, "camera.durationMs", null],
  ["holds a chip's own camera to the same rule", (s) => { delete s.chips[0].camera.durationMs; }, "chips.0.camera.durationMs", null],
  ["runs the swap detector on a chip's camera too", (s) => { const cam = s.chips[0].camera; s.chips[0].camera = { ...cam, lat: cam.lng, lng: cam.lat }; }, "chips.0.camera.lat", /lat and lng may be swapped/],
  ["rejects an I18n object with no ko", (s) => { s.layers[0].label = { en: "Bars" }; }, "layers.0.label.ko", null],
  ["rejects an unknown kind rather than falling back to one", (s) => { s.layers[0].defaultVisibleWhen = { kind: "sometimes" }; }, "layers.0.defaultVisibleWhen.kind", null],
  ...(["never", "always"] as const).map((kind): [string, Mutation, string, RegExp] => [
    `rejects windows on kind "${kind}", which never reads them`,
    (s) => { s.layers[0].defaultVisibleWhen = { kind, windows: [{ start: "18:00", end: "00:00" }] }; },
    "layers.0.defaultVisibleWhen.windows",
    new RegExp(`is read only on kind "scheduled", and this layer is "${kind}"`),
  ]),
  ["rejects a scheduled layer with no windows", (s) => { s.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [] }; }, "layers.0.defaultVisibleWhen.windows", /must not be empty — a layer that is on all day is \{"kind":"always"\}/],
  ...["24:00", "7:00", "25:00", "18:60", "1800", "18:00:00", ""].flatMap((bound) =>
    (["start", "end"] as const).map((key): [string, Mutation, string, null] => [
      `rejects ${JSON.stringify(bound)} at the ${key} of a window`,
      (s) => { s.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [{ start: "11:00", end: "23:00", [key]: bound }] }; },
      `layers.0.defaultVisibleWhen.windows.0.${key}`,
      null,
    ]),
  ),
  ...[{}, 3, "18:00"].map((windows): [string, Mutation, string, null] => [
    `rejects ${JSON.stringify(windows)} in place of a windows array`,
    (s) => { s.layers[0].defaultVisibleWhen = { kind: "scheduled", windows }; },
    "layers.0.defaultVisibleWhen.windows",
    null,
  ]),
  ["rejects equal bounds", (s) => { s.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [{ start: "18:00", end: "18:00" }] }; }, "layers.0.defaultVisibleWhen.windows.0", /has equal bounds "18:00"/],
  ["rejects a timezone the wire contract cannot honour", (s) => { s.timezone = "Asia/Seuol"; }, "timezone", null],
  ["refuses a non-boolean interactive rather than coercing it", (s) => { s.itemDefaults.fallback.interactive = "false"; }, "itemDefaults.fallback.interactive", null],
  ["names the exact category when its interactive is wrong", (s) => { s.itemDefaults.byCategory.bar.interactive = 1; }, "itemDefaults.byCategory.bar.interactive", null],
  ...["numberCircle", "numberDot", "pin", "TextLabel"].map((style): [string, Mutation, string, null] => [
    `refuses the markerStyle ${style}`,
    (s) => { s.layers[0].markerStyle = style; },
    "layers.0.markerStyle",
    null,
  ]),
  ["requires the facets key", (s) => { delete s.facets; }, "facets", null],
  ["rejects duplicate facet ids", (s) => { s.facets.push({ ...s.facets[1], options: [{ id: "x", label: { ko: "x" } }] }); }, "", /config\.facets has a duplicate id "org"/],
  ["rejects an option id reused in another facet", (s) => { s.facets[1].options[0].id = "day1"; }, "", /config\.facets\[\]\.options has a duplicate id "day1"/],
  ["rejects overlapping day windows", (s) => { s.facets[0].options[1].from = "2026-10-02T05:00:00+09:00"; }, "facets.0.options", /"day1" and "day2" overlap/],
  ["rejects a bound without an explicit offset", (s) => { s.facets[0].options[0].from = "2026-10-01T06:00:00"; }, "facets.0.options.0.from", /must carry an explicit offset/],
  ["rejects from not before until", (s) => { s.facets[0].options[0].until = s.facets[0].options[0].from; }, "facets.0.options.0.from", /must be before until/],
  ["rejects a window on a tag option", (s) => { s.facets[1].options[0].from = "2026-10-01T06:00:00+09:00"; }, "facets.1.options.0", /is a tag option and must not carry from\/until/],
  ["rejects an unknown source rather than defaulting one", (s) => { s.facets[0].source = "date"; }, "facets.0.source", null],
  ["rejects a missing select rather than defaulting one", (s) => { delete s.facets[1].select; }, "facets.1.select", null],
  ["rejects a list naming a facet that does not exist", (s) => { chipById(s, "eskara26_view_bar").list.facetIds = ["day", "price"]; }, "", /config\.chips\[0\]\.list\.facetIds\[1\] "price" is not in config\.facets/],
  ["rejects a sort scope the list does not show", (s) => { chipById(s, "eskara26_view_bar").list.sort.scopeFacetId = "org"; }, "", /\.sort\.scopeFacetId "org" is not one of this list's facetIds/],
  ["rejects a scoped title sort", (s) => { chipById(s, "eskara26_view_food").list.sort.scopeFacetId = "day"; }, "chips.2.list.sort.scopeFacetId", /must be null when key is "title"/],
  ["requires scopeFacetId to be written", (s) => { delete chipById(s, "eskara26_view_bar").list.sort.scopeFacetId; }, "chips.0.list.sort.scopeFacetId", /is required \(null for none\)/],
];

describe("checkedLayerSet", () => {
  it("passes the fixture's layer set, and parses it as layerSetFile does", () => {
    // Act
    const parsed = checkedLayerSet.safeParse(fixtureSet());

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(layerSetFile.parse(fixtureSet()));
  });

  it.each(PORTED_REJECTIONS)("%s, at its path", (_title, mutate, issuePath, message) => {
    // Arrange
    const set = fixtureSet();
    mutate(set);

    // Act
    const issues = issuesOf(set);

    // Assert
    expect(issues).toContainEqual({ path: issuePath, message: message === null ? expect.any(String) : expect.stringMatching(message) });
  });

  it("reports every invalid chip of the served row together", () => {
    // Arrange
    const set = fixtureSet();
    set.chips[0].layerIds = ["nope"];
    set.chips[1].layerIds = ["building_numbers"];

    // Act
    const issues = issuesOf(set);

    // Assert
    expect(issues).toEqual([
      { path: "chips", message: 'chip "eskara26_view_bar": "nope" is not a layer' },
      { path: "chips", message: 'chip "eskara26_view_booth": layer "building_numbers" has chipGroupId null, so no chip may change it' },
    ]);
  });

  it("passes the edits the committed-file loader passed: a single-layer chip without a label, a wrapping window, a checklist scope", () => {
    // Arrange
    const set = fixtureSet();
    delete set.chips[0].label;
    set.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [{ start: "22:00", end: "02:00" }] };
    chipById(set, "eskara26_view_booth").list.sort.scopeFacetId = "org";

    // Act & Assert
    expect(issuesOf(set)).toEqual([]);
  });
});

describe("checkedLayerSet, on the values a set may write or leave out", () => {
  it("reads an explicit null defaultVisibleWhen as always on, the way it reads an absent one", () => {
    // Arrange
    const set = fixtureSet();
    set.layers[0].defaultVisibleWhen = null;

    // Act & Assert
    expect(checkedLayerSet.parse(set).layers[0]!.defaultVisibleWhen).toEqual({ kind: "always" });
  });

  it("keeps a scheduled layer's windows as written, a wrap past midnight included", () => {
    // Arrange
    // 18:00 after 00:00 says "past midnight" rather than being a swapped pair.
    const set = fixtureSet();
    set.layers[0].defaultVisibleWhen = { kind: "scheduled", windows: [{ start: "18:00", end: "00:00" }, { start: "11:00", end: "14:00" }] };

    // Act & Assert
    expect(checkedLayerSet.parse(set).layers[0]!.defaultVisibleWhen).toEqual({
      kind: "scheduled",
      windows: [{ start: "18:00", end: "00:00" }, { start: "11:00", end: "14:00" }],
    });
  });

  it("reads an explicit null interactive as tappable, and carries an explicit false through", () => {
    // Arrange
    // A null must not fail closed and silently take every tap off the category.
    const set = fixtureSet();
    set.itemDefaults.fallback.interactive = null;
    set.itemDefaults.byCategory.bar.interactive = false;

    // Act
    const parsed = checkedLayerSet.parse(set);

    // Assert
    expect(parsed.itemDefaults.fallback.interactive).toBe(true);
    expect(parsed.itemDefaults.byCategory.bar!.interactive).toBe(false);
  });

  it("accepts textLabel, the bare caption a zone's name is drawn with", () => {
    // Arrange
    const set = fixtureSet();
    set.layers[0].markerStyle = "textLabel";

    // Act & Assert
    expect(checkedLayerSet.parse(set).layers[0]!.markerStyle).toBe("textLabel");
  });

  it("leaves an absent chip camera absent, so the chip flies to the set's camera", () => {
    // Arrange
    const set = fixtureSet();
    delete set.chips[0].camera;

    // Act & Assert
    expect(checkedLayerSet.parse(set).chips[0]!.camera).toBeUndefined();
  });

  it("passes a multi-layer chip that carries its label", () => {
    // Arrange
    const set = fixtureSet();
    set.chips[0].layerIds = [set.layers[0].id, set.layers[1].id];
    set.chips[0].label = { ko: "먹거리·주점" };

    // Act & Assert
    expect(issuesOf(set)).toEqual([]);
  });

  it("passes a set with no facets and no lists: [] is how a festival says it has none", () => {
    // Arrange
    const set = fixtureSet();
    set.facets = [];
    for (const chip of set.chips) delete chip.list;

    // Act & Assert
    expect(issuesOf(set)).toEqual([]);
  });

  it("parses a day option's bounds into its window as instants, and gives a tag option none", () => {
    // Act
    const facets = checkedLayerSet.parse(fixtureSet()).facets;

    // Assert
    expect(facets.find((f) => f.id === "day")!.options[0]!.window).toEqual({
      from: new Date("2026-09-30T21:00:00.000Z"),
      until: new Date("2026-10-01T21:00:00.000Z"),
    });
    expect(facets.find((f) => f.id === "org")!.options.every((o) => o.window === null)).toBe(true);
  });
});

describe("layerSetsDataset", () => {
  it("passes the fixture, revision 1 of map-layer-sets", () => {
    // Act & Assert
    expect(layerSetsDataset.safeParse(fixtureDataset()).success).toBe(true);
  });

  it("refuses a layerSetId stored twice, at the second one's path", () => {
    // Arrange
    const dataset = fixtureDataset();
    dataset.layerSets.push(fixtureSet());

    // Act
    const parsed = layerSetsDataset.safeParse(dataset);

    // Assert
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))).toEqual([
      { path: "layerSets.1.layerSetId", message: 'repeats the layer set "eskara-2026" of layerSets[0]' },
    ]);
  });

  it("refuses a bad set at its index in the dataset", () => {
    // Arrange
    const dataset = fixtureDataset();
    dataset.layerSets[0]!.chips[0].layerIds = ["nope"];

    // Act
    const parsed = layerSetsDataset.safeParse(dataset);

    // Assert
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["layerSets.0.chips"]);
  });
});

describe("storedLayerSets", () => {
  const stored = (data: unknown): Record<string, unknown> => ({ revision: 3, data });

  it("reads a stored envelope's sets, each parsed as checkedLayerSet parses it", () => {
    // Act
    const parsed = storedLayerSets.safeParse(stored(fixtureDataset()));

    // Assert
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ revision: 3, data: { layerSets: [checkedLayerSet.parse(fixtureSet())], rejected: [] } });
  });

  it.each(["revision", "data"])("refuses an envelope without %s", (field) => {
    // Arrange
    const envelope = stored(fixtureDataset());
    delete envelope[field];

    // Act & Assert
    expect(storedLayerSets.safeParse(envelope).success).toBe(false);
  });

  it("refuses data without a layerSets array", () => {
    // Act & Assert
    expect(storedLayerSets.safeParse(stored({ layerSets: {} })).success).toBe(false);
  });

  it("leaves out a bad set with its id, index and issues, and keeps the others", () => {
    // Arrange
    const bad = fixtureSet();
    bad.layerSetId = "spring-2027";
    bad.chips[0].layerIds = ["nope"];
    const dataset = { layerSets: [bad, fixtureSet()] };

    // Act
    const parsed = storedLayerSets.parse(stored(dataset));

    // Assert
    expect(parsed.data.layerSets.map((set) => set.layerSetId)).toEqual(["eskara-2026"]);
    expect(parsed.data.rejected).toEqual([
      { index: 0, layerSetId: "spring-2027", issues: ['chips: chip "eskara26_view_bar": "nope" is not a layer'] },
    ]);
  });

  it("leaves out a repeated set and keeps the first, and names a set without a readable id by its index alone", () => {
    // Arrange
    const dataset = { layerSets: [fixtureSet(), fixtureSet(), { layerSetId: 7 }] };

    // Act
    const parsed = storedLayerSets.parse(stored(dataset));

    // Assert
    expect(parsed.data.layerSets).toHaveLength(1);
    expect(parsed.data.rejected).toEqual([
      { index: 1, layerSetId: "eskara-2026", issues: ['layerSetId: repeats the layer set "eskara-2026" of layerSets[0]'] },
      { index: 2, layerSetId: null, issues: expect.arrayContaining([expect.stringMatching(/^layerSetId: /)]) },
    ]);
  });
});
