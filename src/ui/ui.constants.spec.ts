/**
 * The carousel limits home and campus share: a rotation is off (0) or 2 to 30
 * seconds.
 */
import { MAX_AUTO_ROTATE_SEC, MIN_AUTO_ROTATE_SEC, isAutoRotateSec } from "./ui.constants";

describe("isAutoRotateSec", () => {
  it.each([
    [0, true],
    [MIN_AUTO_ROTATE_SEC - 1, false],
    [MIN_AUTO_ROTATE_SEC, true],
    [MIN_AUTO_ROTATE_SEC + 1, true],
    [MAX_AUTO_ROTATE_SEC - 1, true],
    [MAX_AUTO_ROTATE_SEC, true],
    [MAX_AUTO_ROTATE_SEC + 1, false],
  ])("answers %p with %p", (sec, expected) => {
    // Act & Assert
    expect(isAutoRotateSec(sec)).toBe(expected);
  });
});
