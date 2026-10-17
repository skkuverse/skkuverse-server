/**
 * laneConfigFile, the shape of bus-lane.json: the committed file passes as it is, a copy missing any top-level field
 * fails at that field, and a malformed corridor fails with every type issue at once, each at its path.
 */
import { laneConfigFile } from "./bus-eta-lane.schema";

const committed: Record<string, unknown> = require("./bus-lane.json");

const copy = (): Record<string, unknown> => JSON.parse(JSON.stringify(committed));

describe("laneConfigFile", () => {
  it("passes the committed file as it is", () => {
    // Act
    const parsed = laneConfigFile.parse(committed);

    // Assert
    expect(parsed).toEqual(committed);
  });

  it.each(Object.keys(laneConfigFile.shape))("fails a copy without %s at that field", (field) => {
    // Arrange
    const rest = copy();
    delete rest[field];

    // Act
    const result = laneConfigFile.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it("fails a malformed corridor with every issue, each at its path", () => {
    // Arrange
    const broken = copy();
    const corridor = broken.corridor as { centerline: Array<Record<string, unknown>>; boundaries: Array<Record<string, unknown>> };
    corridor.centerline[3] = { lat: "37.5", lng: 127.02 };
    corridor.centerline[5] = { lat: 137.5, lng: 127.02 };
    delete corridor.boundaries[1]!.alongM;
    const routes = broken.probeRoutes as Array<{ sectOrds: { southbound: Record<string, unknown> } }>;
    routes[0]!.sectOrds.southbound.from = 45.5;
    broken.laneHours = { from: "7:00", to: "21:00" };

    // Act
    const result = laneConfigFile.safeParse(broken);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([
      ["laneHours", "from"],
      ["corridor", "centerline", 3, "lat"],
      ["corridor", "centerline", 5, "lat"],
      ["corridor", "boundaries", 1, "alongM"],
      ["probeRoutes", 0, "sectOrds", "southbound", "from"],
    ]);
  });

  it("fails a strategy other than car or busLane, and a bus-lane strategy without a direction", () => {
    // Arrange
    const broken = copy();
    broken.strategies = {
      "campus-inja": { regular: { strategy: "bus" }, hakbu: { strategy: "busLane" } },
    };

    // Act
    const result = laneConfigFile.safeParse(broken);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([
      ["strategies", "campus-inja", "regular", "strategy"],
      ["strategies", "campus-inja", "hakbu", "direction"],
    ]);
  });

  it("fails a centerline of one vertex", () => {
    // Arrange
    const broken = copy();
    const corridor = broken.corridor as { centerline: unknown[] };
    corridor.centerline = corridor.centerline.slice(0, 1);

    // Act
    const result = laneConfigFile.safeParse(broken);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["corridor", "centerline"]]);
  });
});
