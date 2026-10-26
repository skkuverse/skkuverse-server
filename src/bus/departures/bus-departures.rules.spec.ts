/**
 * The stops a bus ride passes between its board and alight stops (ADR 0022, D5, amended 2026-10-26): in travel order,
 * never either end, and none the run passes without stopping, which the caller names.
 */
import { toStopsBetween } from "./bus-departures.rules";

const STOPS = ["a", "b", "c", "d", "e"];

describe("toStopsBetween", () => {
  it.each([
    ["the stops strictly between, in travel order", 0, 4, ["b", "c", "d"]],
    ["none when the alight stop follows the board stop", 1, 2, []],
    ["one when a single stop lies between", 2, 4, ["d"]],
  ])("lists %s", (_case, boardIndex, alightIndex, expected) => {
    // Act & Assert
    expect(toStopsBetween(STOPS, { boardIndex, alightIndex })).toEqual(expected);
  });

  it("leaves out a stop the run passes without stopping", () => {
    // Act & Assert
    expect(toStopsBetween(STOPS, { boardIndex: 0, alightIndex: 4 }, (stop) => stop !== "c")).toEqual(["b", "d"]);
  });
});
