/**
 * The build-asset registration guard for the bus stop catalog's JSON files.
 *
 * `tsc` does not copy JSON, so every file a module reads at runtime must be
 * staged into dist/ by scripts/copy-build-assets.js. A miss breaks production
 * only — the dev watcher and jest read src/ — and for the stop catalog the
 * symptom is an api that exits at boot.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const STOPS_DIR = path.join(ROOT, "src/bus/stops");
const ASSET_SCRIPT = path.join(ROOT, "scripts/copy-build-assets.js");

describe("bus stop catalog JSON assets", () => {
  it("lists the boarding-stop catalog in copy-build-assets.js", () => {
    // Act
    const assetScript = fs.readFileSync(ASSET_SCRIPT, "utf8");

    // Assert
    expect(assetScript).toContain('["src/bus/stops/schedule-stops.json", "dist/src/bus/stops/schedule-stops.json"]');
  });

  it("lists every JSON file in src/bus/stops", () => {
    // Arrange
    const assetScript = fs.readFileSync(ASSET_SCRIPT, "utf8");

    // Act
    const onDisk = fs.readdirSync(STOPS_DIR).filter((f) => f.endsWith(".json"));

    // Assert
    expect(onDisk.length).toBeGreaterThan(0);
    for (const fileName of onDisk) {
      expect(assetScript).toContain(`dist/src/bus/stops/${fileName}`);
    }
  });
});
