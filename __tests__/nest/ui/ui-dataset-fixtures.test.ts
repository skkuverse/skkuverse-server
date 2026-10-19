/**
 * The wave A dataset fixtures are revision 1 of their datasets, so each must
 * hold exactly what its committed source holds until the source is deleted
 * (move-editorial-datasets D13): the push imports a fixture with `_about`
 * removed, and the reader deploy is byte-compared against production as it
 * served the committed file. A pull request that edits one of the pair
 * without the other fails here. Each case is deleted with its source file.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;

describe("wave A dataset fixtures against their committed sources", () => {
  it.each([
    ["__tests__/nest/ui/fixtures/campus-banners.dataset.json", "src/ui/campus/campus-banners.json"],
    ["__tests__/nest/ui/fixtures/transit-layout.dataset.json", "src/ui/transit/transit-layout.json"],
  ])("%s without _about equals %s", (fixturePath, sourcePath) => {
    // Arrange
    const { _about, ...fixture } = readJson(fixturePath);

    // Act
    const source = readJson(sourcePath);

    // Assert
    expect(_about).toEqual(expect.stringContaining("5c0ee5a9"));
    expect(fixture).toEqual(source);
  });
});
