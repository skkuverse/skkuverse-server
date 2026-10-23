/**
 * subwayStationCoordsDataset, the shape of the `subway-station-coords`
 * dataset: each served station's camera point, `{ lat, lng }` in WGS84
 * degrees, keyed by station slug. A push is refused on it and the read parses
 * with it. Revision 1 (the fixture) passes as it is; a point outside South
 * Korea (lat 33 to 39, lng 124 to 132, so a swapped pair lands outside), a
 * missing coordinate and a key the dataset does not hold are each refused at
 * their path. storedStationCoords, the stored document as the repository
 * reads it, needs its revision and data.
 */
import { stationCoordsFixture } from "../../../__tests__/helpers/subway/station-coords";
import { storedStationCoords, subwayStationCoordsDataset } from "./subway-station-coords.schema";

// The fixture as untyped JSON, so a test can break its shape.
const fixture = (): Record<string, any> => stationCoordsFixture();

function messagesOf(raw: unknown): string[] {
  const result = subwayStationCoordsDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const withHyehwa = (point: Record<string, unknown>): Record<string, any> => {
  const data = fixture();
  data.stations.hyehwa = point;
  return data;
};

describe("subwayStationCoordsDataset", () => {
  it("passes revision 1 as it is, in its order", () => {
    // Act
    const parsed = subwayStationCoordsDataset.parse(fixture());

    // Assert
    expect(parsed).toEqual(fixture());
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(fixture()));
  });

  it("fails a copy without stations", () => {
    // Act & Assert
    expect(messagesOf({})).toEqual(["stations: Invalid input: expected record, received undefined"]);
  });

  it("fails a key the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ ...fixture(), exits: {} })).toEqual([': Unrecognized key: "exits"']);
  });

  it.each(["lat", "lng"])("fails a station without %s, naming it", (field) => {
    // Arrange
    const point: Record<string, unknown> = { lat: 37.582336, lng: 127.001844 };
    delete point[field];

    // Act & Assert
    expect(messagesOf(withHyehwa(point))).toEqual([expect.stringMatching(new RegExp(`^stations\\.hyehwa\\.${field}: `))]);
  });

  it("fails a field a point does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf(withHyehwa({ lat: 37.582336, lng: 127.001844, zoom: 16 }))).toEqual(['stations.hyehwa: Unrecognized key: "zoom"']);
  });

  it.each([
    ["lat 32.999 (below)", { lat: 32.999, lng: 127 }],
    ["lat 39.001 (above)", { lat: 39.001, lng: 127 }],
    ["lng 123.999 (below)", { lat: 37, lng: 123.999 }],
    ["lng 132.001 (above)", { lat: 37, lng: 132.001 }],
    ["a swapped pair", { lat: 127.001844, lng: 37.582336 }],
  ])("fails %s as outside South Korea, naming the station", (_case, point) => {
    // Act & Assert
    expect(messagesOf(withHyehwa(point))).toEqual(["stations.hyehwa: must be { lat, lng } inside South Korea (lat 33 to 39, lng 124 to 132)"]);
  });

  it.each([
    ["at lat 33", { lat: 33, lng: 127 }],
    ["at lat 39", { lat: 39, lng: 127 }],
    ["at lng 124", { lat: 37, lng: 124 }],
    ["at lng 132", { lat: 37, lng: 132 }],
  ])("passes a point %s, on the edge", (_case, point) => {
    // Act & Assert
    expect(messagesOf(withHyehwa(point))).toEqual([]);
  });

  it("fails a coordinate that is not a number", () => {
    // Act & Assert
    expect(messagesOf(withHyehwa({ lat: "37.58", lng: 127.001844 }))).toEqual(["stations.hyehwa.lat: Invalid input: expected number, received string"]);
  });
});

describe("storedStationCoords", () => {
  it("passes a stored document's revision and data", () => {
    // Act
    const parsed = storedStationCoords.parse({ revision: 3, data: fixture() });

    // Assert
    expect(parsed).toEqual({ revision: 3, data: fixture() });
  });

  it.each([["revision"], ["data"]])("fails a document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 3, data: fixture() };
    delete doc[field];

    // Act
    const result = storedStationCoords.safeParse(doc);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});
