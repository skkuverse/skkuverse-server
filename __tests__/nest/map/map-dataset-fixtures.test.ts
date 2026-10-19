/**
 * The wave B dataset fixture is revision 1 of `map-layer-sets`, so it must
 * hold exactly the committed layer set until that file is deleted
 * (move-editorial-datasets D13): the push imports the fixture with `_about`
 * removed, and the reader deploy is byte-compared against production as it
 * served the committed file. A pull request that edits one of the pair
 * without the other fails here. The case is deleted with eskara-2026.json.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;

describe("the map-layer-sets fixture against the committed layer set", () => {
  it("holds, without _about, one layer set equal to src/map/layer-set/eskara-2026.json", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/map/fixtures/map-layer-sets.dataset.json");

    // Act
    const source = readJson("src/map/layer-set/eskara-2026.json");

    // Assert
    expect(_about).toEqual(expect.stringContaining("5c0ee5a9"));
    expect(fixture).toEqual({ layerSets: [source] });
  });
});
