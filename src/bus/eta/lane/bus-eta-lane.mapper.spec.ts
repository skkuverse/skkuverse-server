/**
 * toCorridorSnapshot: one stored `bus-lane-corridor` revision as the live tick reads it (move-reference-datasets D9):
 * the revision, the centerline with its boundaries, the probe routes in their stored order, each direction's entry
 * and exit, and each direction's leg bounds, the entry and the exit projected onto the centerline.
 */
import { corridorFixture } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { toCorridorSnapshot } from "./bus-eta-lane.mapper";
import { toLegBounds } from "./bus-eta-lane.rules";

describe("toCorridorSnapshot", () => {
  it("carries the revision, the corridor and the probe routes as stored", () => {
    // Arrange
    const data = corridorFixture();

    // Act
    const snapshot = toCorridorSnapshot({ revision: 4, data });

    // Assert
    expect(snapshot.revision).toBe(4);
    expect(snapshot.corridor).toEqual(data.corridor);
    expect(snapshot.probeRoutes).toEqual(data.probeRoutes);
  });

  it.each(["southbound", "northbound"] as const)("gives the %s entry and exit and their leg bounds along the centerline", (direction) => {
    // Arrange
    const data = corridorFixture();

    // Act
    const snapshot = toCorridorSnapshot({ revision: 1, data });

    // Assert
    expect(snapshot.corridorEndsOf(direction)).toEqual(data.entryExit[direction]);
    expect(snapshot.legBoundsOf(direction)).toEqual(toLegBounds(data.corridor, data.entryExit[direction]));
  });
});
