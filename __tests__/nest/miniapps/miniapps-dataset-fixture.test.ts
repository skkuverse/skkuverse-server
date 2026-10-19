/**
 * fixtures/miniapps.dataset.json is revision 1 of the `miniapps` dataset
 * (move-miniapp-registry tasks 6.2 and 11.2, design D2 and D12): the committed
 * registry, `src/miniapps/index.json` as `index` and each
 * `details/<id>.json` under its id, in index order. Until the committed files
 * are deleted (task 12.1) they are frozen, so a change to one of them that the
 * fixture, and so the pushed dataset, does not carry fails here.
 */
import fs from "fs";
import path from "path";

const MINIAPPS_DIR = path.join(__dirname, "../../../src/miniapps");

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

function committedRegistry(): { index: { miniApps: Array<{ id: string }> }; details: Record<string, unknown> } {
  const index = readJson(path.join(MINIAPPS_DIR, "index.json")) as { miniApps: Array<{ id: string }> };
  const details = Object.fromEntries(index.miniApps.map(({ id }) => [id, readJson(path.join(MINIAPPS_DIR, "details", `${id}.json`))]));
  return { index, details };
}

function datasetFixture(): Record<string, unknown> {
  const fixture = readJson(path.join(__dirname, "fixtures/miniapps.dataset.json")) as Record<string, unknown>;
  delete fixture._about;
  return fixture;
}

describe("the miniapps dataset fixture", () => {
  it("equals the committed index and details, without its _about", () => {
    // Arrange
    const committed = committedRegistry();

    // Act
    const fixture = datasetFixture();

    // Assert
    expect(fixture).toEqual(committed);
  });

  it("holds every committed detail file, keyed in index order", () => {
    // Arrange
    const detailFiles = fs.readdirSync(path.join(MINIAPPS_DIR, "details")).map((file) => path.basename(file, ".json"));
    const indexIds = committedRegistry().index.miniApps.map(({ id }) => id);

    // Act
    const fixtureIds = Object.keys(datasetFixture().details as Record<string, unknown>);

    // Assert
    expect(fixtureIds).toEqual(indexIds);
    expect([...fixtureIds].sort()).toEqual([...detailFiles].sort());
  });
});
