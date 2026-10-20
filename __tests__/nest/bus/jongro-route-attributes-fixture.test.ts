/**
 * The `jongro-route-attributes` fixture is revision 1 of the dataset, so it
 * must hold exactly the attributes committed in src/bus/jongro-routes.json
 * until that file is deleted (move-reference-datasets D10 and D14): the push
 * imports the fixture with `_about` removed, and the reader deploy is compared
 * byte for byte against what production served from the committed file. A
 * pull request that edits one without the other fails here. The route ids and
 * TOPIS ids stay in code, so the fixture keys each route by its id and leaves
 * out `id` and `busRouteId`. Deleted with jongro-routes.json (task 7.8).
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

interface CommittedRoute extends Record<string, unknown> {
  id: string;
  busRouteId: string;
}

describe("the jongro-route-attributes fixture against the committed file", () => {
  it("holds, without _about, jongro-routes.json keyed by route id without id and busRouteId, in the file's order", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/bus/fixtures/jongro-route-attributes.dataset.json") as Record<string, unknown>;
    const committed = readJson("src/bus/jongro-routes.json") as CommittedRoute[];

    // Act
    const projection = { routes: Object.fromEntries(committed.map(({ id, busRouteId: _busRouteId, ...attributes }) => [id, attributes])) };

    // Assert
    expect(_about).toEqual(expect.stringContaining("d856f333"));
    expect(committed.map((route) => route.busRouteId)).toEqual(["100900008", "100900004", "100900005"]);
    expect(fixture).toEqual(projection);
    expect(JSON.stringify(fixture)).toBe(JSON.stringify(projection));
  });
});
