/**
 * The wave C dataset fixtures are revision 1 of `bus-service-notices` and
 * `skku-rest-days`, so each must hold exactly the content committed in code
 * until that source is removed (move-editorial-datasets D13): the push imports
 * each fixture with `_about` removed, and the reader deploy is byte-compared
 * against production as it served the committed content. A pull request that
 * edits one of a pair without the other fails here. Each case is deleted with
 * its source: the notices one with SERVICE_CONFIG's notices and suspensions,
 * the rest days one with skku-rest-days.json.
 */
import fs from "fs";
import path from "path";
import { SERVICE_CONFIG } from "../../../src/bus/bus.constants";

const ROOT = path.join(__dirname, "../../..");
const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<string, unknown>;

describe("the bus-service-notices fixture against SERVICE_CONFIG", () => {
  it("holds, without _about, every service's notices and suspension, in SERVICE_CONFIG's order", () => {
    // Arrange
    const { _about, ...fixture } = readJson("__tests__/nest/bus/fixtures/bus-service-notices.dataset.json");

    // Act
    const source = Object.fromEntries(Object.entries(SERVICE_CONFIG).map(([serviceId, entry]) => [serviceId, { notices: entry.notices, suspend: entry.suspend }]));

    // Assert
    expect(_about).toEqual(expect.stringContaining("5c0ee5a9"));
    expect(fixture).toEqual({ services: source });
    expect(Object.keys(fixture.services as object)).toEqual(Object.keys(SERVICE_CONFIG));
  });
});

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
