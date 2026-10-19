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
 * The code-held sources (`miniapps`, `busGroups`, `subwayStations`,
 * `busServices`) list the identities the compiled checkout serves, the same
 * lists the server checks against (move-editorial-datasets D3).
 *
 * The wave A datasets (`campus-banners`, `transit-layout`) are checked at push
 * with the checks the boot refused a committed file on (D4, D5), through the
 * tool's own checkData. So is wave B's `map-layer-sets`, with the checks the
 * layer-set loader refused a file on and one set per `layerSetId` (D6). Wave
 * C's `bus-service-notices` names only services the checkout defines (D7), and
 * its `skku-rest-days` keys only calendar month-days and dates (D8).
 */
import path from "node:path";
import { SERVICE_CONFIG } from "../../../src/bus/bus.constants";
import { BusConfigService } from "../../../src/bus/config/bus-config.service";
import { fixtureMiniappsService } from "../../helpers/miniapps/registry-fixture";
import { SubwayStationsService } from "../../../src/subway/stations/subway-stations.service";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const { checkData } = require("../../../scripts/lib/datasets/checks");

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

  it("declares the home layout's checks and its references to the code-held mini app registry", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const entry = catalog.datasets["home-layout"];
    const parsed = entry.schema.parse(homeLayout);

    // Act
    const issues = entry.issuesOf(parsed);
    const references = entry.referencesOf(parsed);

    // Assert
    expect(entry.owner).toBe("src/ui/home");
    expect(issues).toEqual([]);
    expect(references.every((ref: { dataset: string }) => ref.dataset === "miniapps")).toBe(true);
    expect(references.every((ref: { id: string }) => catalog.sources.miniapps.has(ref.id))).toBe(true);
    expect(catalog.sources.miniapps.has("no-such-miniapp")).toBe(false);
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
  const busConfig = new BusConfigService(null as never, null as never);
  const servedIds = {
    miniapps: () => fixtureMiniappsService().list.map((entry) => entry.id),
    busGroups: () => busConfig.listGroupIds(),
    subwayStations: () => new SubwayStationsService().listStations().map((station) => station.id),
    busServices: () => Object.keys(SERVICE_CONFIG),
  };

  it.each([
    ["miniapps", "src/miniapps"],
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

  it.each(["miniapps", "busGroups", "subwayStations", "busServices"] as const)("answers has() for every %s id it lists, and no other", (name) => {
    // Arrange
    const source = loadCatalog(srcLoader).sources[name];

    // Act & Assert
    expect(source.ids().every((id: string) => source.has(id))).toBe(true);
    expect(source.has("no-such-id")).toBe(false);
    expect(source.has("toString")).toBe(false);
  });

  it("pins today's bus groups and a bus service", () => {
    // Arrange
    const { sources } = loadCatalog(srcLoader);

    // Act & Assert
    expect(sources.busGroups.ids()).toEqual(["hssc", "campus", "fasttrack", "commute", "jongro02", "jongro07", "jongro08"]);
    expect(sources.busServices.has("campus-inja")).toBe(true);
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
