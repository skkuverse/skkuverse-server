/**
 * subwayTopologyDataset, the shape of the `subway-topology` dataset:
 * each served platform's two directions, keyed
 * by platform id, and the neighbor stops, keyed by platform id. A push is
 * refused on it and the read parses with it. Revision 1 (the fixture) passes
 * as it is; a copy missing any field of a direction or a neighbor, a malformed
 * platform id, more than three upstream platforms or a name missing a
 * language fails with its path. storedSubwayTopology, the stored document as
 * the repository reads it, needs its revision and data.
 */
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { storedSubwayTopology, subwayTopologyDataset } from "./subway-topology.schema";

// The fixture as untyped JSON, so a test can break its shape.
const fixture = (): Record<string, any> => subwayTopologyFixture();

function messagesOf(raw: unknown): string[] {
  const result = subwayTopologyDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("subwayTopologyDataset", () => {
  it("passes revision 1 as it is, in its order", () => {
    // Act
    const parsed = subwayTopologyDataset.parse(fixture());

    // Assert
    expect(parsed).toEqual(fixture());
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(fixture()));
  });

  it.each(["platforms", "neighbors"])("fails a copy without %s", (field) => {
    // Arrange
    const data = fixture();
    delete data[field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^${field}: `))]);
  });

  it.each([
    [["platforms", "KR-1-P153"], "up"],
    [["platforms", "KR-1-P153"], "down"],
    [["platforms", "KR-1-P153", "up"], "name"],
    [["platforms", "KR-1-P153", "up"], "upstreamPlatformIds"],
    [["platforms", "KR-1-P153", "up"], "watchedPlatformIds"],
    [["platforms", "KR-1-P153", "up"], "nextPlatformId"],
    [["neighbors", "KR-1-P152"], "line"],
    [["neighbors", "KR-1-P152"], "seoulName"],
  ] as const)("fails a copy whose %j has no %s, with its path", (path, field) => {
    // Arrange
    const data = fixture();
    delete path.reduce((node, key) => node[key], data)[field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^${[...path, field].join("\\.")}: `))]);
  });

  it.each([
    ["a platform keyed by a malformed id", (data: Record<string, any>) => (data.platforms["KR-0153"] = data.platforms["KR-1-P153"]), /^platforms\.KR-0153: /],
    [
      "a malformed next platform",
      (data: Record<string, any>) => (data.platforms["KR-1-P153"].up.nextPlatformId = "kr-1-p152"),
      /^platforms\.KR-1-P153\.up\.nextPlatformId: must be <operator>-<line>-<station>$/,
    ],
    [
      "four upstream platforms",
      (data: Record<string, any>) => data.platforms["KR-1-P153"].up.upstreamPlatformIds.push("KR-1-1716"),
      /^platforms\.KR-1-P153\.up\.upstreamPlatformIds: /,
    ],
    ["a direction name without zh", (data: Record<string, any>) => delete data.platforms["S1-4-420"].down.name.zh, /^platforms\.S1-4-420\.down\.name\.zh: /],
    ["a neighbor name without en", (data: Record<string, any>) => delete data.neighbors["KR-1-P152"].name.en, /^neighbors\.KR-1-P152\.name\.en: /],
    ["a neighbor keyed by a station name", (data: Record<string, any>) => (data.neighbors["의왕"] = { line: "1", seoulName: "의왕" }), /^neighbors\.의왕: /],
    ["a misspelled optional field", (data: Record<string, any>) => (data.neighbors["KR-1-P152"].trainmapName = "의왕"), /^neighbors\.KR-1-P152: Unrecognized key/],
    ["a station's field on a direction", (data: Record<string, any>) => (data.platforms["S1-4-420"].up.line = "4"), /^platforms\.S1-4-420\.up: Unrecognized key/],
  ])("fails %s, with its path", (_case, arrange, message) => {
    // Arrange
    const data = fixture();
    arrange(data);

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(message)]);
  });

  it.each([
    ["Station id: a neighbor's station id that is no slug", (data: Record<string, any>) => (data.neighbors["S1-4-421"].stationId = "Dongdaemun"), /^neighbors\.S1-4-421\.stationId: must be a lowercase slug$/],
    [
      "Coords: a neighbor's coords with lat and lng swapped",
      (data: Record<string, any>) => (data.neighbors["S1-4-421"].coords = { lat: 127.009287, lng: 37.57093 }),
      /^neighbors\.S1-4-421\.coords: must be \{ lat, lng \} inside South Korea/,
    ],
    ["a neighbor's coords without lng", (data: Record<string, any>) => delete data.neighbors["S1-4-421"].coords.lng, /^neighbors\.S1-4-421\.coords\.lng: /],
    [
      "Station id without coords: a neighbor a journey stop could name and not place",
      (data: Record<string, any>) => delete data.neighbors["S1-4-421"].coords,
      /^neighbors\.S1-4-421\.coords: a neighbor with a station id needs coords$/,
    ],
    ["coords without a station id", (data: Record<string, any>) => delete data.neighbors["S1-4-421"].stationId, /^neighbors\.S1-4-421\.stationId: a neighbor with coords needs a station id$/],
  ])("fails %s, with its path", (_case, arrange, message) => {
    // Arrange
    const data = fixture();
    arrange(data);

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(message)]);
  });

  it("passes a neighbor with no station id and no coords, as revision 2 stored every one", () => {
    // Arrange
    const data = fixture();
    delete data.neighbors["S1-4-421"].stationId;
    delete data.neighbors["S1-4-421"].coords;

    // Act & Assert
    expect(messagesOf(data)).toEqual([]);
  });

  it("passes a neighbor with no name and no train-map name", () => {
    // Arrange
    const data = fixture();
    delete data.neighbors["KR-1-P151"].name;
    delete data.neighbors["KR-1-P151"].trainMapName;

    // Act & Assert
    expect(messagesOf(data)).toEqual([]);
  });
});

describe("storedSubwayTopology", () => {
  it("passes a stored revision with its data", () => {
    // Act & Assert
    expect(storedSubwayTopology.safeParse({ revision: 1, data: fixture() }).success).toBe(true);
  });

  it.each(["revision", "data"])("fails a stored document without %s", (field) => {
    // Arrange
    const stored: Record<string, unknown> = { revision: 1, data: fixture() };
    delete stored[field];

    // Act
    const result = storedSubwayTopology.safeParse(stored);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([field]);
  });
});
