/**
 * The TOPIS service key must be present and URL-encoded: a raw base64 key
 * splits the query string and TOPIS rejects it as if it were down. And the
 * one duplicate stop a route may hold: its last ord repeating its first.
 */
import { isLoopClosingRepeat, validateServiceKey } from "./bus.rules";

const FIXED_KEY =
  "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";

describe("validateServiceKey", () => {
  it("rejects missing / empty key with 'is required'", () => {
    // Act & Assert
    expect(validateServiceKey(undefined).some((e) => e.includes("is required"))).toBe(true);
    expect(validateServiceKey("").some((e) => e.includes("is required"))).toBe(true);
  });

  it("rejects raw special chars that indicate non-URL-encoded form", () => {
    // Act & Assert
    expect(validateServiceKey("ABC+DEF=").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC&DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
    expect(validateServiceKey("ABC DEF").some((e) => e.includes("URL-encoded"))).toBe(true);
  });

  it("accepts a properly URL-encoded prod-shaped key", () => {
    // Act & Assert
    expect(validateServiceKey(FIXED_KEY)).toEqual([]);
    expect(validateServiceKey("test-seoul-bus-key")).toEqual([]);
  });
});

describe("isLoopClosingRepeat", () => {
  it.each([
    [["A", "B", "A"], 2, true],
    [["A", "B", "B"], 2, false],
    [["A", "A", "B"], 1, false],
    [["A"], 0, false],
  ])("%j at %i → %s", (topisIds, index, expected) => {
    // Act & Assert
    expect(isLoopClosingRepeat(topisIds, index)).toBe(expected);
  });
});
