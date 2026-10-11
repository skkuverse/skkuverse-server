/**
 * The build-asset registration guard (skkuverse#14).
 *
 * `tsc` does not copy JSON, so every structure config must be staged into dist/
 * by scripts/copy-build-assets.js. Missing one breaks PRODUCTION ONLY — the dev
 * watcher reads from src/ and never notices — and the symptom there is an event
 * map that simply is not there, which is indistinguishable from a finished
 * festival.
 *
 * Adding a layer set needs three coordinated edits (the JSON, LAYER_SET_FILES,
 * the asset list). This test is the cheapest thing that makes forgetting the
 * third one loud, and it is the reason LAYER_SET_FILES is an explicit list
 * rather than a readdir.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const CONFIG_DIR = path.join(ROOT, "src/map/layer-set");
const ASSET_SCRIPT = path.join(ROOT, "scripts/copy-build-assets.js");
const CONFIG_MODULE = path.join(ROOT, "src/map/layer-set/map-layer-set.constants.ts");

/** The filenames listed in map-layer-set.constants.ts's LAYER_SET_FILES. */
function declaredConfigFiles(): string[] {
  const source = fs.readFileSync(CONFIG_MODULE, "utf8");
  const block = /const LAYER_SET_FILES = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error("LAYER_SET_FILES not found in map-layer-set.constants.ts");
  return [...block[1]!.matchAll(/"([^"]+\.json)"/g)].map((m) => m[1]!);
}

describe("event map structure configs", () => {
  it("registers every declared config in copy-build-assets.js", () => {
    // Arrange
    const assetScript = fs.readFileSync(ASSET_SCRIPT, "utf8");

    // Act & Assert
    for (const fileName of declaredConfigFiles()) {
      expect(assetScript).toContain(`src/map/layer-set/${fileName}`);
      expect(assetScript).toContain(`dist/src/map/layer-set/${fileName}`);
    }
  });

  it("declares every config file that exists on disk", () => {
    // Arrange
    // The other direction: a JSON added to the directory but never listed is
    // simply inert, which is a quieter failure than a missing one.
    const onDisk = fs
      .readdirSync(CONFIG_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();

    // Act & Assert
    expect(declaredConfigFiles().sort()).toEqual(onDisk);
  });
});
