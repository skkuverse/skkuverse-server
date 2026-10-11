/**
 * The carousel rules home and campus share: a rotation is off (0) or 2 to 30
 * seconds, a banner shows inside its half-open window [startAt, endAt), and
 * the first repeated id is named.
 */
import { MAX_AUTO_ROTATE_SEC, MIN_AUTO_ROTATE_SEC, findDuplicateId, isAutoRotateSec, isBannerShowing } from "./ui.rules";

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

describe("isBannerShowing", () => {
  const window = { startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-03T00:00:00+09:00" };

  it.each([
    ["2026-09-30T14:59:59.999Z", false],
    ["2026-09-30T15:00:00.000Z", true],
    ["2026-10-02T14:59:59.999Z", true],
    ["2026-10-02T15:00:00.000Z", false],
  ])("at %s answers %p for [startAt, endAt)", (iso, expected) => {
    // Act & Assert
    expect(isBannerShowing(window, new Date(iso))).toBe(expected);
  });

  it("shows a banner without a window, and one with an open end after its start", () => {
    // Arrange
    const now = new Date("2030-01-01T00:00:00Z");

    // Act & Assert
    expect(isBannerShowing({}, now)).toBe(true);
    expect(isBannerShowing({ startAt: window.startAt }, now)).toBe(true);
    expect(isBannerShowing({ endAt: window.endAt }, now)).toBe(false);
  });
});

describe("findDuplicateId", () => {
  it("names the first id seen twice, and nothing when all differ", () => {
    // Act & Assert
    expect(findDuplicateId(["a", "b", "c", "b", "a"])).toBe("b");
    expect(findDuplicateId(["a", "b", "c"])).toBeUndefined();
    expect(findDuplicateId([])).toBeUndefined();
  });
});
