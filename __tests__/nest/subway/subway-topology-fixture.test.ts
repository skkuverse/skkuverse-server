/**
 * The `subway-topology` fixture is revision 1 of the dataset, so it must hold
 * exactly the directions and neighbors committed in
 * src/subway/subway-registry.json until that file is deleted
 * (move-reference-datasets D2, D3 and D14): the push imports the fixture with
 * `_about` removed, and the reader deploy is compared with what production
 * served from the committed file. A pull request that edits one without the
 * other fails here. The lines, stations and platform identities stay in code,
 * so the fixture keys each platform's two directions by its platform id, in
 * the registry's order, and keeps the neighbors as they are. Deleted with
 * subway-registry.json (task 10.6).
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

interface CommittedRegistry {
  stations: Array<{ platforms: Array<{ id: string; directions: unknown }> }>;
  neighbors: Record<string, unknown>;
}

/** The registry's directions keyed by platform id, and its neighbors: what `subway-topology` holds. */
function toSubwayTopologyData(registry: CommittedRegistry): { platforms: Record<string, unknown>; neighbors: Record<string, unknown> } {
  const platforms = registry.stations.flatMap((station) => station.platforms).map((platform) => [platform.id, platform.directions]);
  return { platforms: Object.fromEntries(platforms), neighbors: registry.neighbors };
}

describe("the subway-topology fixture against the committed registry", () => {
  it("holds, without _about, every platform's directions by platform id in the registry's order, and its neighbors", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/subway/fixtures/subway-topology.dataset.json") as Record<string, unknown>;
    const committed = readJson("src/subway/subway-registry.json") as CommittedRegistry;

    // Act
    const projection = toSubwayTopologyData(committed);

    // Assert
    expect(_about).toEqual(expect.stringContaining("d856f333"));
    expect(Object.keys(projection.platforms)).toHaveLength(13);
    expect(fixture).toEqual(projection);
    expect(JSON.stringify(fixture)).toBe(JSON.stringify(projection));
  });
});
