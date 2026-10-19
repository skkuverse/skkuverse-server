/**
 * The `bus-lane-corridor` fixture is revision 1 of the dataset, so it must hold
 * exactly the corridor committed in src/bus/eta/lane/bus-lane.json until that
 * file is deleted (move-reference-datasets D9 and D14): the push imports the
 * fixture with `_about` removed, and the reader deploy is compared against the
 * live estimates production stored from the committed file. A pull request
 * that edits one without the other fails here. The lane hours and strategies
 * stay in code, so the fixture leaves them out. Deleted with bus-lane.json
 * (task 5.7).
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;

describe("the bus-lane-corridor fixture against the committed file", () => {
  it("holds, without _about, bus-lane.json without laneHours and strategies, in the file's key order", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/bus/fixtures/bus-lane-corridor.dataset.json");

    // Act
    const { laneHours, strategies, ...source } = readJson("src/bus/eta/lane/bus-lane.json");

    // Assert
    expect(_about).toEqual(expect.stringContaining("f74ff3f3"));
    expect(laneHours).toBeDefined();
    expect(strategies).toBeDefined();
    expect(fixture).toEqual(source);
    expect(JSON.stringify(fixture)).toBe(JSON.stringify(source));
  });
});
