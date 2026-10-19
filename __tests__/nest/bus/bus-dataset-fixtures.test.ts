/**
 * The skku-rest-days fixture is revision 1 of the dataset, so it must hold
 * exactly the committed file until that file is deleted
 * (move-editorial-datasets D13): the push imports the fixture with `_about`
 * removed, and the reader deploy is byte-compared against production as it
 * served the committed file. A pull request that edits one of the pair without
 * the other fails here. The case is deleted with skku-rest-days.json.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;

describe("the skku-rest-days fixture against the committed file", () => {
  it("holds, without _about, src/bus/schedule/skku-rest-days.json without its _ keys", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/bus/fixtures/skku-rest-days.dataset.json");

    // Act
    const source = Object.fromEntries(Object.entries(readJson("src/bus/schedule/skku-rest-days.json")).filter(([key]) => !key.startsWith("_")));

    // Assert
    expect(_about).toEqual(expect.stringContaining("5c0ee5a9"));
    expect(fixture).toEqual(source);
    expect(Object.keys(fixture)).toEqual(Object.keys(source));
  });
});
