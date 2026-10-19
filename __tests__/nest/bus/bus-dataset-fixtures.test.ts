/**
 * The skku-rest-days fixture is revision 1 of the dataset, so it must hold
 * exactly the committed file until that file is deleted
 * (move-editorial-datasets D13): the push imports the fixture with `_about`
 * removed, and the reader deploy is byte-compared against production as it
 * served the committed file. A pull request that edits one of the pair without
 * the other fails here, and so does a dataset schema that reads the fixture
 * as other rest days than the boot read the file as. The cases are deleted
 * with skku-rest-days.json.
 */
import fs from "fs";
import path from "path";
import { skkuRestDaysDataset } from "../../../src/bus/schedule-content/bus-schedule-content.schema";
import { loadRestDays } from "../../../src/bus/schedule/bus-schedule.config";

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

  it("reads, with the dataset's schema, as the RestDays loadRestDays gives for the committed file", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/bus/fixtures/skku-rest-days.dataset.json");

    // Act
    const parsed = skkuRestDaysDataset.parse(fixture);

    // Assert
    expect(_about).toEqual(expect.any(String));
    expect(parsed).toEqual(loadRestDays(readJson("src/bus/schedule/skku-rest-days.json")));
  });
});
