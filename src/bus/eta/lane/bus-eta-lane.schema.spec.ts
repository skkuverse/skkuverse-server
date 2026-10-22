/**
 * laneCorridorDataset, the shape of the `bus-lane-corridor` dataset: the corridor, its
 * entry and exit points and the probe routes, which a push is refused on and the read parses with. Revision 1 (the
 * fixture) passes as it is, and each structure and range case the committed corridor file was refused on is refused
 * at its path. storedLaneCorridor, the stored document as the repository reads it, needs its revision and data.
 */
import { corridorFixture as storedFixture } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { laneCorridorDataset, storedLaneCorridor } from "./bus-eta-lane.schema";

// The fixture as untyped JSON, so a test can break its shape.
const corridorFixture = (): Record<string, any> => storedFixture();

const issuePaths = (result: { error?: { issues: Array<{ path: PropertyKey[] }> } }) => result.error?.issues.map((issue) => issue.path);

describe("laneCorridorDataset", () => {
  it("accepts revision 1 as it is", () => {
    // Arrange
    const fixture = corridorFixture();

    // Act
    const parsed = laneCorridorDataset.parse(fixture);

    // Assert
    expect(parsed).toEqual(fixture);
  });

  it.each(Object.keys(laneCorridorDataset.shape))("refuses a copy without %s at that field", (field) => {
    // Arrange
    const rest = corridorFixture();
    delete rest[field];

    // Act
    const result = laneCorridorDataset.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual([[field]]);
  });

  it("refuses the lane hours and strategies, which are code, as unknown keys", () => {
    // Arrange
    const withCode = { ...corridorFixture(), laneHours: { from: "07:00", to: "21:00" }, strategies: {} };

    // Act
    const result = laneCorridorDataset.safeParse(withCode);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues).toEqual([expect.objectContaining({ code: "unrecognized_keys", keys: ["laneHours", "strategies"], path: [] })]);
  });

  it("refuses a malformed corridor, entry and exit and probe route with every issue, each at its path", () => {
    // Arrange
    const broken = corridorFixture();
    broken.corridor.centerline[3] = { lat: "37.5", lng: 127.02 };
    broken.corridor.centerline[5] = { lat: 137.5, lng: 127.02 };
    delete broken.corridor.boundaries[1].alongM;
    broken.entryExit.northbound.exit = { lat: 37.5, lng: 227.02 };
    broken.probeRoutes[0].sectOrds.southbound.from = 45.5;
    broken.probeRoutes[1].routeId = "G5000";

    // Act
    const result = laneCorridorDataset.safeParse(broken);

    // Assert
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual([
      ["corridor", "centerline", 3, "lat"],
      ["corridor", "centerline", 5, "lat"],
      ["corridor", "boundaries", 1, "alongM"],
      ["entryExit", "northbound", "exit", "lng"],
      ["probeRoutes", 0, "sectOrds", "southbound", "from"],
      ["probeRoutes", 1, "routeId"],
    ]);
  });

  it("refuses a centerline of one vertex, one boundary, a negative along-distance and no probe route", () => {
    // Arrange
    const broken = corridorFixture();
    broken.corridor.centerline = broken.corridor.centerline.slice(0, 1);
    broken.corridor.boundaries = [{ name: "한남IC", alongM: -1 }];
    broken.probeRoutes = [];

    // Act
    const result = laneCorridorDataset.safeParse(broken);

    // Assert
    expect(issuePaths(result)).toEqual([
      ["corridor", "centerline"],
      ["corridor", "boundaries", 0, "alongM"],
      ["corridor", "boundaries"],
      ["probeRoutes"],
    ]);
  });
});

describe("storedLaneCorridor", () => {
  it("parses a stored document's revision and data", () => {
    // Arrange
    const doc = { revision: 3, data: corridorFixture() };

    // Act
    const parsed = storedLaneCorridor.parse(doc);

    // Assert
    expect(parsed).toEqual(doc);
  });

  it.each(["revision", "data"])("refuses a stored document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 1, data: corridorFixture() };
    delete doc[field];

    // Act
    const result = storedLaneCorridor.safeParse(doc);

    // Assert
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual([[field]]);
  });
});
