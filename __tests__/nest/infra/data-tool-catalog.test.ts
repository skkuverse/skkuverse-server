/**
 * The `npm run data` catalog (scripts/lib/datasets/catalog.js, design D1 and
 * D6 of openspec/changes/archive/2026-10-19-move-runtime-data-to-db): the datasets the tool knows
 * and the server code that validates each one. The command line loads it over
 * `dist/src`; this test loads the same catalog over `src/` through ts-jest, so
 * the catalog covered here is the catalog the tool runs.
 *
 * The tool picks its database from `--prod`, never from NODE_ENV, so loading
 * the catalog must not load src/infra/config.ts, which exits on a missing value
 * and picks `_dev` on its own.
 *
 * The code-held sources (`busGroups`, `subwayStations`, `busServices`) list
 * the identities the compiled checkout serves, the same lists the server
 * checks against (move-editorial-datasets D3).
 *
 * The mini app registry is the `miniapps` dataset (move-miniapp-registry D6):
 * its push runs the server's registry schema and the first-party owner check,
 * it lists its ids for others to reference, and the three ui datasets check
 * their mini app ids and targets against the `miniapps` the target database
 * stores (`storedOf`), refused as not stored when it holds none.
 *
 * The wave A datasets (`campus-banners`, `transit-layout`) are checked at push
 * with the checks the boot refused a committed file on (D4, D5), through the
 * tool's own checkData. So is wave B's `map-layer-sets`, with the checks the
 * layer-set loader refused a file on and one set per `layerSetId` (D6). Wave
 * C's `bus-service-notices` names only services the checkout defines (D7), and
 * its `skku-rest-days` keys only calendar month-days and dates (D8).
 *
 * The `bus-lane-corridor` dataset (move-reference-datasets D9) is checked with
 * the server's corridor schema and `corridorIssues`, the geometry checks the
 * boot refused the committed corridor file on; the lane hours and strategies
 * are code.
 *
 * The `jongro-route-attributes` dataset (move-reference-datasets D10) is
 * checked with the server's attributes schema and against the `jongroRoutes`
 * code-held source, the route ids JONGRO_ROUTES holds: one entry per route the
 * checkout serves, no more.
 *
 * The `subway-topology` dataset (move-reference-datasets D2, D3) is checked
 * with the server's topology schema and `toTopologyIssues` against the
 * checkout's SUBWAY_LINES and SUBWAY_STATIONS: one entry per served platform
 * (the `subwayPlatforms` code-held source), no more, and every named stop
 * resolvable; a checkout whose own identities clash refuses every push. A
 * topology whose stops resolve is then checked against the checkout's
 * committed timetable routes (`toRouteIssues`): upstream, watched and next
 * platforms in route order, and every stop the tracker follows named.
 *
 * The `subway-timetables` dataset (move-reference-datasets D4, D5, D6) is
 * stored in parts, one per table: each part runs the server's `timetableFile`
 * schema and is keyed by `toTimetableKey` (`<operator>-<line>-<dayType>`),
 * two tables of one key are refused, and the set is refused while a platform
 * the checkout serves has no table for a day type its source declares. Its
 * routes are then checked against the target's stored `subway-topology`, and
 * the stops the tracker follows against the run properties
 * (`toTrackedStopIssues`), as warnings: a coverage change pushes its tables
 * first, and the topology push stays the gate that refuses (wave D review F1).
 */
import path from "node:path";
import { JONGRO_ROUTES, SERVICE_CONFIG } from "../../../src/bus/bus.constants";
import { corridorIssues } from "../../../src/bus/eta/lane/bus-eta-lane.rules";
import { laneCorridorDataset } from "../../../src/bus/eta/lane/bus-eta-lane.schema";
import { jongroRouteAttributesDataset } from "../../../src/bus/route-attributes/bus-route-attributes.schema";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import { fixtureRegistry, fixtureRegistryWithWaveRun } from "../../helpers/miniapps/registry-fixture";
import { SubwayStationsService } from "../../../src/subway/stations/subway-stations.service";
import { SUBWAY_STATIONS } from "../../../src/subway/subway.constants";
import { subwayTopologyDataset } from "../../../src/subway/topology/subway-topology.schema";
import { toTimetableKey } from "../../../src/subway/timetable/subway-timetable.rules";
import { timetableFile } from "../../../src/subway/timetable/subway-timetable.schema";
import { subwayTimetableFixtureFiles } from "../../helpers/subway/timetables";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const { checkData, checkParts } = require("../../../scripts/lib/datasets/checks");

const SRC = path.join(__dirname, "../../../src");
const CONFIG = path.join(SRC, "infra/config");
const srcLoader = (relativePath: string): unknown => require(path.join(SRC, relativePath));

const fixture = require("../ui/fixtures/home-layout.dataset.json") as Record<string, unknown>;
const { _about, ...homeLayout } = fixture;
void _about;

/** A dataset fixture's data, as the push imports it: a fresh copy without `_about`. */
function datasetFixture(relativePath: string): Record<string, unknown> {
  const { _about: note, ...data } = structuredClone(require(relativePath)) as Record<string, unknown>;
  void note;
  return data;
}

type Issue = { dataset: string; path: Array<string | number>; message: string };
const issueLines = (issues: Issue[]): string[] => issues.map((issue) => `${issue.dataset}: ${issue.path.join(".")}: ${issue.message}`);

describe("loadCatalog", () => {
  it("accepts revision 1 of the stored home layout with the server's schema", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const result = catalog.datasets["home-layout"].schema.safeParse(homeLayout);

    // Assert
    expect(result.success).toBe(true);
  });

  it("refuses a misspelt key, naming its path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = structuredClone(homeLayout) as { sections: Array<{ tiles?: Array<Record<string, unknown>> }> };
    const tile = layout.sections[1]!.tiles![0]!;
    tile.actoinType = tile.actionType;
    delete tile.actionType;

    // Act
    const result = catalog.datasets["home-layout"].schema.safeParse(layout);

    // Assert
    expect(result.success).toBe(false);
    const messages = result.error.issues.map((issue: { path: unknown[]; message: string }) => `${issue.path.join(".")}: ${issue.message}`);
    expect(messages.join("\n")).toContain("sections.1.tiles.0");
    expect(messages.join("\n")).toContain("actoinType");
  });

  it("declares the home layout's checks and its references to the stored mini app registry", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["home-layout"];
    const parsed = entry.schema.parse(homeLayout);
    const registry = catalog.datasets.miniapps.schema.parse(fixtureRegistry());
    const registeredIds: string[] = catalog.datasets.miniapps.idsOf(registry);

    // Act
    const issues = entry.issuesOf(parsed, { storedOf: (name: string) => (name === "miniapps" ? registry : null) });
    const references = entry.referencesOf(parsed);

    // Assert
    expect(entry.owner).toBe("src/ui/home");
    expect(issues).toEqual([]);
    expect(references.every((ref: { dataset: string }) => ref.dataset === "miniapps")).toBe(true);
    expect(references.every((ref: { id: string }) => registeredIds.includes(ref.id))).toBe(true);
    expect(registeredIds).not.toContain("no-such-miniapp");
  });

  it("never loads src/infra/config", () => {
    // Arrange
    let configLoaded = false;

    // Act
    jest.isolateModules(() => {
      jest.doMock(CONFIG, () => {
        configLoaded = true;
        return {};
      });
      loadCatalog(srcLoader);
    });

    // Assert
    expect(configLoaded).toBe(false);
  });
});

describe("loadCatalog code-held sources", () => {
  // BusConfigService.listGroupIds reads neither of its providers.
  const busConfig = new BusConfigService(null as never, null as never, null as never);
  const servedIds = {
    busGroups: () => busConfig.listGroupIds(),
    subwayStations: () => new SubwayStationsService().listStations().map((station) => station.id),
    busServices: () => Object.keys(SERVICE_CONFIG),
  };

  it.each([
    ["busGroups", "src/bus"],
    ["subwayStations", "src/subway"],
    ["busServices", "src/bus"],
  ] as const)("lists the %s ids the server serves, in its order, owned by %s", (name, owner) => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const source = catalog.sources[name];

    // Assert
    expect(source.owner).toBe(owner);
    expect(source.ids()).toEqual(servedIds[name]());
    expect(source.ids().length).toBeGreaterThan(0);
  });

  it.each(["busGroups", "subwayStations", "busServices"] as const)("answers has() for every %s id it lists, and no other", (name) => {
    // Arrange
    const source = loadCatalog(srcLoader).sources[name];

    // Act & Assert
    expect(source.ids().every((id: string) => source.has(id))).toBe(true);
    expect(source.has("no-such-id")).toBe(false);
    expect(source.has("toString")).toBe(false);
  });

  it("lists the jongroRoutes ids JONGRO_ROUTES holds, in its order, owned by src/bus", () => {
    // Arrange
    const source = loadCatalog(srcLoader).sources.jongroRoutes;

    // Act & Assert
    expect(source.owner).toBe("src/bus");
    expect(source.ids()).toEqual(JONGRO_ROUTES.map((route) => route.id));
    expect(source.ids()).toEqual(["jongro02", "jongro07", "jongro08"]);
    expect(source.has("jongro07")).toBe(true);
    expect(source.has("hssc")).toBe(false);
  });

  it("lists the subwayPlatforms ids SUBWAY_STATIONS holds, in its order, owned by src/subway", () => {
    // Arrange
    const source = loadCatalog(srcLoader).sources.subwayPlatforms;

    // Act & Assert
    expect(source.owner).toBe("src/subway");
    expect(source.ids()).toEqual(SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id)));
    expect(source.ids()).toHaveLength(13);
    expect(source.has("S1-4-420")).toBe(true);
    expect(source.has("hyehwa")).toBe(false);
  });

  it("pins today's bus groups and a bus service", () => {
    // Arrange
    const { sources } = loadCatalog(srcLoader);

    // Act & Assert
    expect(sources.busGroups.ids()).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
    expect(sources.busServices.has("campus-inja")).toBe(true);
  });
});

describe("loadCatalog miniapps", () => {
  type Registry = ReturnType<typeof fixtureRegistry>;

  it("is owned by src/miniapps, has no code-held source, and accepts revision 1 with no issue and no reference, listing its ten ids", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets.miniapps;

    // Act
    const issues = checkData(catalog, "miniapps", fixtureRegistry(), {});

    // Assert
    expect(entry.owner).toBe("src/miniapps");
    expect(catalog.sources.miniapps).toBeUndefined();
    expect(issues).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(fixtureRegistry()))).toEqual([]);
    expect(entry.idsOf(entry.schema.parse(fixtureRegistry()))).toEqual(["inja", "eskara-2026", "timetable", "mukja", "playlist", "booth-box", "hssc", "nsc", "skkuw", "skkuzine"]);
  });

  it("Index entry without a detail: refuses wave-run, naming its index path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data: Registry = fixtureRegistryWithWaveRun();
    delete data.details["wave-run"];

    // Act
    const lines = issueLines(checkData(catalog, "miniapps", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^miniapps: index\.miniApps\.10\.id: .*wave-run/)]);
  });

  it("Owner moved to another mini app: refuses mukja's and playlist's startUrl, naming both paths", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data: Registry = fixtureRegistry();
    data.details.mukja!.startUrl = "https://mukja.example.com/";
    data.details.playlist!.startUrl = "https://mukja.mini.skkuverse.com/";

    // Act
    const issues = checkData(catalog, "miniapps", data, {}) as Issue[];

    // Assert
    expect(issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining(["details.mukja.startUrl", "details.playlist.startUrl"]));
    expect(issues.every((issue) => issue.dataset === "miniapps")).toBe(true);
  });

  it("Unlisted first-party host: refuses a start page on wave-run.mini.skkuverse.com, naming its startUrl path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data: Registry = fixtureRegistryWithWaveRun();
    data.details["wave-run"]!.startUrl = "https://wave-run.mini.skkuverse.com/";

    // Act
    const lines = issueLines(checkData(catalog, "miniapps", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^miniapps: details\.wave-run\.startUrl: .*wave-run\.mini\.skkuverse\.com/)]);
  });

  it("Third-party start page: accepts a mini app on another host", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const issues = checkData(catalog, "miniapps", fixtureRegistryWithWaveRun(), {});

    // Assert
    expect(issues).toEqual([]);
  });

  it("Removing a mini app the home layout names: refuses, naming home-layout, the tile's path and the id", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = structuredClone(homeLayout) as { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
    const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
    layout.sections[grid]!.tiles!.push({ kind: "miniapp", id: "skkuw" });
    const at = layout.sections[grid]!.tiles!.length - 1;
    const data: Registry = fixtureRegistry();
    data.index.miniApps = data.index.miniApps.filter((entry) => entry.id !== "skkuw");
    delete data.details.skkuw;

    // Act
    const issues = checkData(catalog, "miniapps", data, { miniapps: fixtureRegistry(), "home-layout": layout });

    // Assert
    expect(issues).toEqual([{ dataset: "home-layout", path: ["sections", grid, "tiles", at, "id"], message: '"skkuw" is no longer in miniapps' }]);
  });
});

describe("loadCatalog ui datasets against the stored miniapps", () => {
  type Layout = { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
  const development = () => ({ miniapps: fixtureRegistryWithWaveRun() });
  const production = () => ({ miniapps: fixtureRegistry() });

  function layoutWithWaveRunTile(): { layout: Layout; path: Array<string | number> } {
    const layout = structuredClone(homeLayout) as Layout;
    const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
    // The game tile wave-run gives way: tile ids are one namespace.
    const tiles = layout.sections[grid]!.tiles!.filter((tile) => tile.id !== "wave-run");
    tiles.push({ kind: "miniapp", id: "wave-run" });
    layout.sections[grid]!.tiles = tiles;
    return { layout, path: ["sections", grid, "tiles", tiles.length - 1, "id"] };
  }

  it("Development and production registries differ: stores a home layout's wave-run tile in _dev and refuses it in production", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const { layout, path: tilePath } = layoutWithWaveRunTile();

    // Act
    const toDevelopment = checkData(catalog, "home-layout", layout, development());
    const toProduction = checkData(catalog, "home-layout", layout, production()) as Issue[];

    // Assert
    expect(toDevelopment).toEqual([]);
    expect(toProduction.map((issue) => [issue.dataset, issue.path])).toEqual([["home-layout", tilePath]]);
    expect(toProduction[0]!.message).toContain("wave-run");
  });

  it("Referenced dataset not stored: refuses a home layout's wave-run tile, naming its path and miniapps as not stored", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const { layout, path: tilePath } = layoutWithWaveRunTile();

    // Act
    const issues = checkData(catalog, "home-layout", layout, {});

    // Assert
    expect(issues).toEqual([{ dataset: "home-layout", path: tilePath, message: '"wave-run" is not in miniapps (no stored dataset)' }]);
  });

  it("Target registered only in development: refuses a banner targeting wave-run in production, naming its actionValue path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const banners = datasetFixture("../ui/fixtures/campus-banners.dataset.json") as { items: Array<Record<string, unknown>> };
    banners.items[2] = { ...banners.items[2], actionType: "miniapp", actionValue: "wave-run/entry" };

    // Act
    const toDevelopment = checkData(catalog, "campus-banners", banners, development());
    const toProduction = issueLines(checkData(catalog, "campus-banners", banners, production()));
    const toNone = issueLines(checkData(catalog, "campus-banners", banners, {}));

    // Assert
    expect(toDevelopment).toEqual([]);
    expect(toProduction).toEqual([expect.stringMatching(/^campus-banners: items\.2\.actionValue: .*wave-run/)]);
    expect(toNone).toEqual(['campus-banners: items.2.actionValue: "wave-run" is not in miniapps (no stored dataset)']);
  });

  it("Link to a mini app the target database lacks: refuses a transit link to wave-run, naming its path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = datasetFixture("../ui/fixtures/transit-layout.dataset.json") as { sections: Array<{ items: Array<Record<string, unknown>> }> };
    layout.sections[0]!.items.push({ kind: "link", id: "wave", title: { ko: "웨이브" }, icon: { type: "taxi", color: "FFB300", text: { ko: "W" } }, actionType: "miniapp", actionValue: "wave-run" });

    // Act
    const toDevelopment = checkData(catalog, "transit-layout", layout, development());
    const toProduction = issueLines(checkData(catalog, "transit-layout", layout, production()));
    const toNone = issueLines(checkData(catalog, "transit-layout", layout, {}));

    // Assert
    expect(toDevelopment).toEqual([]);
    expect(toProduction).toEqual([expect.stringMatching(/^transit-layout: sections\.0\.items\.2\.actionValue: .*wave-run/)]);
    expect(toNone).toEqual(['transit-layout: sections.0.items.2.actionValue: "wave-run" is not in miniapps (no stored dataset)']);
  });
});

describe("loadCatalog campus-banners", () => {
  const banners = () => datasetFixture("../ui/fixtures/campus-banners.dataset.json") as { items: Array<Record<string, unknown>> };

  it("is owned by src/ui/campus and accepts revision 1 with no issue and no reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["campus-banners"];

    // Act
    const issues = checkData(catalog, "campus-banners", banners(), {});

    // Assert
    expect(entry.owner).toBe("src/ui/campus");
    expect(issues).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(banners()))).toEqual([]);
  });

  it("refuses a banner whose miniapp target is unregistered, naming its actionValue path and the id", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = banners();
    data.items[2] = { ...data.items[2], actionType: "miniapp", actionValue: "no-such-miniapp/entry" };

    // Act
    const lines = issueLines(checkData(catalog, "campus-banners", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^campus-banners: items\.2\.actionValue: .*no-such-miniapp/)]);
  });

  it("refuses an image off the media bucket, naming its imageUrl path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = banners();
    data.items[0] = { ...data.items[0], imageUrl: "https://evil.com/a.webp" };

    // Act
    const lines = issueLines(checkData(catalog, "campus-banners", data, {}));

    // Assert
    expect(lines).toEqual(["campus-banners: items.0.imageUrl: must be an object on the media bucket"]);
  });
});

describe("loadCatalog transit-layout", () => {
  type Section = { id: string; items: Array<Record<string, unknown>> };
  const layout = () => datasetFixture("../ui/fixtures/transit-layout.dataset.json") as { sections: Section[] };

  it("is owned by src/ui/transit and accepts revision 1 against the checkout's bus groups, stations and registry", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const issues = checkData(catalog, "transit-layout", layout(), {});

    // Assert
    expect(catalog.datasets["transit-layout"].owner).toBe("src/ui/transit");
    expect(issues).toEqual([]);
  });

  it("New bus group not placed: refuses a layout without jongro08, naming the unplaced group", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = layout();
    const hssc = data.sections.find((section) => section.id === "hssc")!;
    hssc.items = hssc.items.filter((item) => item.groupId !== "jongro08");

    // Act
    const lines = issueLines(checkData(catalog, "transit-layout", data, {}));

    // Assert
    expect(lines).toEqual(['transit-layout: sections: bus group "jongro08" is not placed']);
  });

  it("Unknown group: refuses a placed nope group, naming the item's path and nope", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = layout();
    data.sections[0]!.items.push({ kind: "bus", groupId: "nope" });

    // Act
    const lines = issueLines(checkData(catalog, "transit-layout", data, {}));

    // Assert
    expect(lines).toEqual(['transit-layout: sections.0.items.2.groupId: "nope" is not a bus group']);
  });

  it("Station placed twice: refuses subway:hyehwa in two sections, naming the second placement", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = layout();
    data.sections[2]!.items.push({ kind: "subway", stationId: "hyehwa" });

    // Act
    const lines = issueLines(checkData(catalog, "transit-layout", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^transit-layout: sections\.2\.items\.3: item "subway:hyehwa" is placed more than once$/)]);
  });

  it("lists its bus group, station and mini app references against the code-held sources", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["transit-layout"];

    // Act
    const references = entry.referencesOf(entry.schema.parse(layout())) as Array<{ dataset: string; id: string }>;

    // Assert
    expect(new Set(references.map((reference) => reference.dataset))).toEqual(new Set(["busGroups", "subwayStations"]));
    expect(references.every((reference) => catalog.sources[reference.dataset].has(reference.id))).toBe(true);
  });
});

describe("loadCatalog map-layer-sets", () => {
  const layerSets = () => datasetFixture("../map/fixtures/map-layer-sets.dataset.json") as { layerSets: Array<Record<string, any>> };

  it("is owned by src/map/layer-set and accepts revision 1 with no issue and no reference, naming its sets", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["map-layer-sets"];

    // Act
    const issues = checkData(catalog, "map-layer-sets", layerSets(), {});

    // Assert
    expect(issues).toEqual([]);
    expect(entry.owner).toBe("src/map/layer-set");
    expect(entry.referencesOf(entry.schema.parse(layerSets()))).toEqual([]);
    expect(entry.idsOf(entry.schema.parse(layerSets()))).toEqual(["eskara-2026"]);
  });

  it("Chip names an unknown layer: refuses the set, naming its index, the chip and the id", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = layerSets();
    data.layerSets[0]!.chips[0].layerIds = ["nope"];

    // Act
    const lines = issueLines(checkData(catalog, "map-layer-sets", data, {}));

    // Assert
    expect(lines).toEqual(['map-layer-sets: layerSets.0.chips: chip "eskara26_view_bar": "nope" is not a layer']);
  });

  it("Two sets share an id: refuses the push, naming the second one's path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = layerSets();
    data.layerSets.push(structuredClone(data.layerSets[0]!));

    // Act
    const lines = issueLines(checkData(catalog, "map-layer-sets", data, {}));

    // Assert
    expect(lines).toEqual(['map-layer-sets: layerSets.1.layerSetId: repeats the layer set "eskara-2026" of layerSets[0]']);
  });
});

describe("loadCatalog bus-service-notices", () => {
  const notices = () => datasetFixture("../bus/fixtures/bus-service-notices.dataset.json") as { services: Record<string, any> };

  it("is owned by src/bus/schedule-content and accepts revision 1, naming each service as a busServices reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["bus-service-notices"];

    // Act
    const issues = checkData(catalog, "bus-service-notices", notices(), {});

    // Assert
    expect(issues).toEqual([]);
    expect(entry.owner).toBe("src/bus/schedule-content");
    expect(entry.referencesOf(entry.schema.parse(notices())).map((ref: { dataset: string; id: string }) => `${ref.dataset}:${ref.id}`)).toEqual(
      Object.keys(SERVICE_CONFIG).map((serviceId) => `busServices:${serviceId}`),
    );
  });

  it("Unknown service: refuses notices for campus-jaja, naming its path and the id", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = notices();
    data.services["campus-jaja"] = { notices: [{ style: "info", text: "공지" }], suspend: null };

    // Act
    const lines = issueLines(checkData(catalog, "bus-service-notices", data, {}));

    // Assert
    expect(lines).toEqual(['bus-service-notices: services.campus-jaja: "campus-jaja" is not in busServices']);
  });

  it("Suspension out of order: refuses it, naming its until path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = notices();
    data.services["campus-inja"].suspend = { from: "2027-02-28", until: "2026-12-21" };

    // Act
    const lines = issueLines(checkData(catalog, "bus-service-notices", data, {}));

    // Assert
    expect(lines).toEqual(["bus-service-notices: services.campus-inja.suspend.until: until must not be before from"]);
  });
});

describe("loadCatalog skku-rest-days", () => {
  const restDays = () => datasetFixture("../bus/fixtures/skku-rest-days.dataset.json") as Record<string, string>;

  it("is owned by src/bus/schedule-content and accepts revision 1 with no reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["skku-rest-days"];

    // Act
    const issues = checkData(catalog, "skku-rest-days", restDays(), {});

    // Assert
    expect(issues).toEqual([]);
    expect(entry.owner).toBe("src/bus/schedule-content");
    expect(entry.referencesOf(entry.schema.parse(restDays()))).toEqual([]);
  });

  it("Day that is not on the calendar: refuses the key 02-30, naming it", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const lines = issueLines(checkData(catalog, "skku-rest-days", { ...restDays(), "02-30": "휴일" }, {}));

    // Assert
    expect(lines).toEqual(["skku-rest-days: 02-30: must be a calendar MM-DD or a calendar YYYY-MM-DD from 1900 to 2999"]);
  });
});

describe("loadCatalog bus-lane-corridor", () => {
  const corridor = () => datasetFixture("../bus/fixtures/bus-lane-corridor.dataset.json") as { corridor: { boundaries: Array<{ alongM: number }> }; probeRoutes: unknown[] };

  it("is owned by src/bus/eta/lane, takes laneCorridorDataset and corridorIssues, and accepts revision 1 with no issue and no reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["bus-lane-corridor"];

    // Act
    const issues = checkData(catalog, "bus-lane-corridor", corridor(), {});

    // Assert
    expect(entry.owner).toBe("src/bus/eta/lane");
    expect(entry.schema).toBe(laneCorridorDataset);
    expect(entry.issuesOf).toBe(corridorIssues);
    expect(issues).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(corridor()))).toEqual([]);
  });

  it("Boundary past the end: refuses a last boundary 500 m past the centerline's end, naming that boundary's path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = corridor();
    data.corridor.boundaries[8]!.alongM += 500;

    // Act
    const lines = issueLines(checkData(catalog, "bus-lane-corridor", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^bus-lane-corridor: corridor\.boundaries\.8\.alongM: "신갈JC" must be at the centerline's end/)]);
  });

  it("Probe route listed twice: refuses 200000205 listed again, naming the second entry's routeId", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = corridor();
    data.probeRoutes.push(structuredClone(data.probeRoutes[0]));

    // Act
    const lines = issueLines(checkData(catalog, "bus-lane-corridor", data, {}));

    // Assert
    expect(lines).toEqual(["bus-lane-corridor: probeRoutes.3.routeId: 8800: route 200000205 is listed twice"]);
  });

  it("refuses the lane hours, which are code, as a key the dataset does not hold", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const lines = issueLines(checkData(catalog, "bus-lane-corridor", { ...corridor(), laneHours: { from: "07:00", to: "21:00" } }, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^bus-lane-corridor: : .*laneHours/)]);
  });
});

describe("loadCatalog jongro-route-attributes", () => {
  type Attributes = { routes: Record<string, Record<string, unknown>> };
  const attributes = () => datasetFixture("../bus/fixtures/jongro-route-attributes.dataset.json") as Attributes;

  it("is owned by src/bus/route-attributes, takes jongroRouteAttributesDataset, and accepts revision 1 with no issue and no reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["jongro-route-attributes"];

    // Act
    const issues = checkData(catalog, "jongro-route-attributes", attributes(), {});

    // Assert
    expect(entry.owner).toBe("src/bus/route-attributes");
    expect(entry.schema).toBe(jongroRouteAttributesDataset);
    expect(issues).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(attributes()))).toEqual([]);
  });

  it("Seat count zero: refuses seatCount 0 for jongro07, naming routes.jongro07.seatCount", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = attributes();
    data.routes.jongro07!.seatCount = 0;

    // Act
    const lines = issueLines(checkData(catalog, "jongro-route-attributes", data, {}));

    // Assert
    expect(lines).toEqual(["jongro-route-attributes: routes.jongro07.seatCount: required positive integer"]);
  });

  it("Route missing: refuses attributes holding jongro02 and jongro07 only, naming jongro08 as missing", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = attributes();
    delete data.routes.jongro08;

    // Act
    const lines = issueLines(checkData(catalog, "jongro-route-attributes", data, {}));

    // Assert
    expect(lines).toEqual(['jongro-route-attributes: routes.jongro08: missing: the checked-out code serves "jongro08", so it needs attributes']);
  });

  it("Missing seat count: refuses jongro08 without a seat count, naming jongro08", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = attributes();
    delete data.routes.jongro08!.seatCount;

    // Act
    const lines = issueLines(checkData(catalog, "jongro-route-attributes", data, {}));

    // Assert
    expect(lines).toEqual(["jongro-route-attributes: routes.jongro08.seatCount: Invalid input: expected number, received undefined"]);
  });

  it("refuses attributes for a route the checkout does not serve, naming it", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = attributes();
    data.routes.jongro13 = structuredClone(data.routes.jongro07!);

    // Act
    const lines = issueLines(checkData(catalog, "jongro-route-attributes", data, {}));

    // Assert
    expect(lines).toEqual(['jongro-route-attributes: routes.jongro13: "jongro13" is not a route the checked-out code serves']);
  });
});

describe("loadCatalog subway-topology", () => {
  type Topology = { platforms: Record<string, Record<string, any>>; neighbors: Record<string, Record<string, unknown>> };
  type Files = Array<{ file: string; data: any }>;
  const topology = () => datasetFixture("../subway/fixtures/subway-topology.dataset.json") as Topology;
  const timetableFiles = (): Files => subwayTimetableFixtureFiles().map(({ file, table }) => ({ file, data: table }));
  // WHY: the target's stored subway-timetables as readStored hands them to a check that reads them: the manifest, each part's data added.
  const storedTimetables = (files: Files = timetableFiles()) => ({
    "subway-timetables": { parts: files.map(({ file, data }) => ({ key: file.replace(/\.json$/, ""), data })) },
  });

  it("is owned by src/subway/topology, takes subwayTopologyDataset, and accepts revision 1 with no issue and no reference", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["subway-topology"];

    // Act
    const issues = checkData(catalog, "subway-topology", topology(), storedTimetables());

    // Assert
    expect(entry.owner).toBe("src/subway/topology");
    expect(entry.schema).toBe(subwayTopologyDataset);
    expect(issues).toEqual([]);
    expect(entry.referencesOf(entry.schema.parse(topology()))).toEqual([]);
  });

  it("reads the stored subway-timetables, the only dataset whose parts its check needs", () => {
    // Act
    const { reads } = loadCatalog(srcLoader).datasets["subway-topology"];

    // Assert
    expect(reads).toEqual(["subway-timetables"]);
  });

  it("Tables stored without a station: refuses revision 1 when the target's stored line 4 tables skip S1-4-419, the routes read from them", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const withoutS14419 = timetableFiles().map(({ file, data }) =>
      file.startsWith("S1-4-")
        ? {
            file,
            data: {
              ...data,
              stations: data.stations.filter((id: string) => id !== "S1-4-419"),
              trains: data.trains.map((train: any) => ({ ...train, stops: train.stops.filter((stop: any) => stop.station !== "S1-4-419") })),
            },
          }
        : { file, data },
    );

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", topology(), storedTimetables(withoutS14419)));

    // Assert
    expect(lines).toContainEqual(expect.stringMatching(/^subway-topology: platforms\.S1-4-420\.down\.upstreamPlatformIds: .*\["S1-4-418","S1-4-417","S1-4-416"\]/));
    expect(lines.every((line) => line.startsWith("subway-topology: platforms.S1-4-420."))).toBe(true);
  });

  it("No stored timetables: refuses revision 1, naming subway-timetables, when the target stores none it can read", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const unparsable = storedTimetables();
    unparsable["subway-timetables"].parts[0]!.data.trains[0].trainNo = "K602";

    // Act
    const lines = [{}, unparsable].map((stored) => issueLines(checkData(catalog, "subway-topology", topology(), stored)));

    // Assert
    const refusal = "subway-topology: subway-timetables: no stored subway-timetables this checkout can read, so the routes were not checked: push subway-timetables first";
    expect(lines).toEqual([[refusal], [refusal]]);
  });

  it("Platform added in code: refuses a topology without S1-2-222, naming it as unplaced", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    delete data.platforms["S1-2-222"];

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, {}));

    // Assert
    expect(lines).toEqual(['subway-topology: platforms.S1-2-222: platform "S1-2-222" is unplaced: the checked-out code serves it, so it needs directions']);
  });

  it("Unknown platform: refuses an entry for S1-9-999, naming its path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    data.platforms["S1-9-999"] = structuredClone(data.platforms["S1-4-420"]!);

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, {}));

    // Assert
    expect(lines).toEqual(['subway-topology: platforms.S1-9-999: "S1-9-999" is not a platform the checked-out code serves']);
  });

  it("Watched stop on another line: refuses S1-3-330 among S1-4-420's watched platforms, naming the path and both lines", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    data.platforms["S1-4-420"]!.up.watchedPlatformIds.push("S1-3-330");

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, {}));

    // Assert
    expect(lines).toEqual(['subway-topology: platforms.S1-4-420.up.watchedPlatformIds.3: "S1-3-330" is on line "3", not "4"']);
  });

  it("Upstream reordered: refuses 혜화 down's second and third upstream platforms swapped, naming the direction's list and the route's order", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    const ids = data.platforms["S1-4-420"]!.down.upstreamPlatformIds;
    [ids[1], ids[2]] = [ids[2], ids[1]];

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, storedTimetables()));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^subway-topology: platforms\.S1-4-420\.down\.upstreamPlatformIds: .*\["S1-4-419","S1-4-418","S1-4-417"\]/)]);
  });

  it("Watched platform dropped with its neighbor: refuses 성균관대 down without 안양 (KR-1-P147), naming the stop the tracker follows", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    data.platforms["KR-1-0153"]!.down.watchedPlatformIds.pop();
    delete data.neighbors["KR-1-P147"];

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, storedTimetables()));

    // Assert
    expect(lines).toContainEqual(expect.stringMatching(/^subway-topology: platforms\.KR-1-0153\.down: "KR-1-P147" .*neither a served platform nor a neighbor$/));
  });

  it("refuses four upstream platforms with the server's schema, naming the direction's list", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const data = topology();
    data.platforms["KR-1-0153"]!.up.upstreamPlatformIds.push("KR-1-1716");

    // Act
    const lines = issueLines(checkData(catalog, "subway-topology", data, {}));

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^subway-topology: platforms\.KR-1-0153\.up\.upstreamPlatformIds: /)]);
  });
});

describe("loadCatalog subway-timetables", () => {
  type Files = Array<{ file: string; data: any }>;
  const files = (): Files => subwayTimetableFixtureFiles().map(({ file, table }) => ({ file, data: table }));

  it("is owned by src/subway/timetable and stores parts with timetableFile, keyed by toTimetableKey, summarized by source and train count", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["subway-timetables"];
    const table = files()[0]!.data;

    // Act
    const summary = entry.parts.summaryOf(timetableFile.parse(table));

    // Assert
    expect(entry.owner).toBe("src/subway/timetable");
    expect(entry.parts.schema).toBe(timetableFile);
    expect(entry.parts.keyOf).toBe(toTimetableKey);
    expect(summary).toEqual({ source: table.source, trainCount: table.trains.length });
    expect(entry.referencesOf([])).toEqual([]);
  });

  it("accepts the 18 tables of the fixture with no issue, one part per key in key order", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const checked = checkParts(catalog, "subway-timetables", files(), {});

    // Assert
    expect(checked.issues).toEqual([]);
    expect(checked.parts.map((part: { key: string }) => part.key)).toEqual(files().map(({ file }) => file.replace(/\.json$/, "")).sort());
  });

  it("Seoul Metro changes line 2: describes a changed table by its trains added and removed, a moved train as both", () => {
    // Arrange
    const entry = loadCatalog(srcLoader).datasets["subway-timetables"];
    const was = timetableFile.parse(files().find(({ file }) => file === "S1-2-weekday.json")!.data);
    const [moved, dropped, ...kept] = was.trains;
    const is = { ...was, trains: [{ ...moved!, stops: moved!.stops.map((stop) => ({ ...stop, arr: stop.arr && stop.arr + 60 })) }, ...kept] };

    // Act
    const changes = entry.parts.changesOf(was, is);

    // Assert
    expect(changes).toEqual([`trains +1 -2 (added ${moved!.trainNo}; removed ${moved!.trainNo}, ${dropped!.trainNo})`]);
  });

  it("describes an unchanged train list as no train change", () => {
    // Arrange
    const entry = loadCatalog(srcLoader).datasets["subway-timetables"];
    const was = timetableFile.parse(files()[0]!.data);

    // Act
    const changes = entry.parts.changesOf(was, { ...was, source: { ...was.source, revision: "2026-11-01" } });

    // Assert
    expect(changes).toEqual(["trains unchanged"]);
  });

  it("Missing Saturday table: refuses a push without S1-4-saturday, naming S1-4-420 saturday", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const withoutSaturday = files().filter(({ file }) => file !== "S1-4-saturday.json");

    // Act
    const lines = issueLines(checkParts(catalog, "subway-timetables", withoutSaturday, {}).issues);

    // Assert
    expect(lines).toEqual(["subway-timetables: S1-4-saturday: no table for S1-4-420 saturday"]);
  });

  it("Malformed train number: refuses a table holding K602, naming the table and the train's path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const tables = files();
    tables.find(({ file }) => file === "KR-1-weekday.json")!.data.trains[2].trainNo = "K602";

    // Act
    const lines = issueLines(checkParts(catalog, "subway-timetables", tables, {}).issues);

    // Assert
    expect(lines).toEqual([expect.stringMatching(/^subway-timetables: KR-1-weekday\.json\.trains\.2\.trainNo: /)]);
  });

  it("Duplicate table: refuses two tables for 1호선 weekdays, naming both", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const tables = files();
    const weekday = tables.find(({ file }) => file === "KR-1-weekday.json")!;
    tables.push({ file: "korail-1-weekday.json", data: structuredClone(weekday.data) });

    // Act
    const lines = issueLines(checkParts(catalog, "subway-timetables", tables, {}).issues);

    // Assert
    expect(lines).toEqual(['subway-timetables: KR-1-weekday: key "KR-1-weekday" is in more than one part: KR-1-weekday.json, korail-1-weekday.json']);
  });
});

describe("loadCatalog subway-timetables against the stored subway-topology", () => {
  type Files = Array<{ file: string; data: any }>;
  const files = (): Files => subwayTimetableFixtureFiles().map(({ file, table }) => ({ file, data: table }));
  const stored = () => ({ "subway-topology": datasetFixture("../subway/fixtures/subway-topology.dataset.json") });
  // WHY: 혜화 down's nearest upstream station dropped from every line 4 table, as a converter run that lost it would.
  const withoutS14419 = (): Files =>
    files().map(({ file, data }) =>
      file.startsWith("S1-4-")
        ? {
            file,
            data: {
              ...data,
              stations: data.stations.filter((id: string) => id !== "S1-4-419"),
              trains: data.trains.map((train: any) => ({ ...train, stops: train.stops.filter((stop: any) => stop.station !== "S1-4-419") })),
            },
          }
        : { file, data },
    );

  it("accepts the fixture against revision 1 of the topology with no issue and no warning", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const checked = checkParts(catalog, "subway-timetables", files(), stored());

    // Assert
    expect(checked.issues).toEqual([]);
    expect(checked.warnings).toEqual([]);
  });

  it("warns, and does not refuse, when the tables' routes disagree with the stored topology", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const checked = checkParts(catalog, "subway-timetables", withoutS14419(), stored());

    // Assert
    expect(checked.issues).toEqual([]);
    expect(checked.parts).toHaveLength(18);
    const lines = issueLines(checked.warnings);
    expect(lines.filter((line) => line.startsWith("subway-timetables: subway-topology.platforms.S1-4-420."))).toHaveLength(3);
    expect(lines).toContainEqual(expect.stringMatching(/^subway-timetables: subway-topology\.platforms\.S1-4-420\.down\.upstreamPlatformIds: .*\["S1-4-418","S1-4-417","S1-4-416"\]/));
  });

  it("warns of a station skipped between the stops the tracker follows, in each line 4 table", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const lines = issueLines(checkParts(catalog, "subway-timetables", withoutS14419(), stored()).warnings);

    // Assert
    expect(lines).toEqual(
      expect.arrayContaining(
        ["weekday", "saturday", "holiday"].map((dayType) => `subway-timetables: S1-4-${dayType}.S1-4-420.down: the tracked stops skip a station between S1-4-418 and S1-4-420`),
      ),
    );
  });

  it("warns that the routes went unchecked when the target stores no topology", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const checked = checkParts(catalog, "subway-timetables", files(), {});

    // Assert
    expect(checked.issues).toEqual([]);
    expect(issueLines(checked.warnings)).toEqual(["subway-timetables: subway-topology: no stored subway-topology, so the tables' routes were not checked against it"]);
  });
});
