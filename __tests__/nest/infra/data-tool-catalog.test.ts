/**
 * The `npm run data` catalog (scripts/lib/datasets/catalog.js, design D1 and
 * D6 of openspec/changes/move-runtime-data-to-db): the datasets the tool knows
 * and the server code that validates each one. The command line loads it over
 * `dist/src`; this test loads the same catalog over `src/` through ts-jest, so
 * the catalog covered here is the catalog the tool runs.
 *
 * The tool picks its database from `--prod`, never from NODE_ENV, so loading
 * the catalog must not load src/infra/config.ts, which exits on a missing value
 * and picks `_dev` on its own.
 */
import path from "node:path";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");

const SRC = path.join(__dirname, "../../../src");
const CONFIG = path.join(SRC, "infra/config");
const srcLoader = (relativePath: string): unknown => require(path.join(SRC, relativePath));

const fixture = require("../ui/fixtures/home-layout.dataset.json") as Record<string, unknown>;
const { _about, ...homeLayout } = fixture;
void _about;

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
