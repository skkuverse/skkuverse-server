/**
 * The realtime mapper the Jongro flow and the arrival flow share: a plate
 * number becomes its last four digits ("----" when there is none).
 */
import { toCarNumber } from "./bus-realtime.mapper";

describe("toCarNumber", () => {
  it.each([
    ["서울74사5537", "5537"],
    ["서울74사1234 ", "1234"],
    [" ", "----"],
    ["", "----"],
    [undefined, "----"],
  ])("%j → %s", (plateNo, expected) => {
    // Act & Assert
    expect(toCarNumber(plateNo)).toBe(expected);
  });
});
