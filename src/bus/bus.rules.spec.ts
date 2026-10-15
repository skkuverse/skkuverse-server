/**
 * The TOPIS service key must be present and URL-encoded: a raw base64 key
 * splits the query string and TOPIS rejects it as if it were down. And the
 * one duplicate stop a route may hold: its last ord repeating its first.
 */
import { deepFreeze, isLoopClosingRepeat, serviceConfigOf, validateServiceKey } from "./bus.rules";

const FIXED_KEY =
  "FAKEseoulBusServiceKeyForTestsOnlyNotARealKey0000%2BFAKE%2Fseoul%2Bbus%2Ftest0key%3D%3D";

describe("validateServiceKey", () => {
  it("reports a missing or empty key as missing", () => {
    // Act & Assert
    expect(validateServiceKey(undefined)).toBe("missing");
    expect(validateServiceKey("")).toBe("missing");
  });

  it("rejects raw special chars that indicate non-URL-encoded form", () => {
    // Act & Assert
    expect(validateServiceKey("ABC+DEF=")).toBe("not-url-encoded");
    expect(validateServiceKey("ABC&DEF")).toBe("not-url-encoded");
    expect(validateServiceKey("ABC DEF")).toBe("not-url-encoded");
  });

  it("accepts a properly URL-encoded prod-shaped key", () => {
    // Act & Assert
    expect(validateServiceKey(FIXED_KEY)).toBeNull();
    expect(validateServiceKey("test-seoul-bus-key")).toBeNull();
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

describe("deepFreeze", () => {
  it("freezes every nested object and array, and returns the same value", () => {
    // Arrange
    const value = { routes: [{ stations: [{ name: "a" }] }] };

    // Act
    const frozen = deepFreeze(value);

    // Assert
    expect(frozen).toBe(value);
    expect(Object.isFrozen(value.routes[0]!.stations[0])).toBe(true);
    expect(Object.isFrozen(value.routes)).toBe(true);
  });
});

describe("serviceConfigOf", () => {
  it.each([["campus-inja", true], ["nope", false], ["toString", false], ["__proto__", false], ["constructor", false]])(
    "%s is a service: %s",
    (serviceId, known) => {
      // Act & Assert
      expect(serviceConfigOf(serviceId) !== undefined).toBe(known);
    },
  );
});

describe("serviceConfigOf for the commute services", () => {
  const COMMUTE_IDS = ["commute-jeongja", "commute-jamsil", "commute-dogok", "commute-gangnam-yangjae", "commute-gwanggyo"];

  it("gives each its own entry and notices, so changing one leaves the others", () => {
    // Act
    const entries = COMMUTE_IDS.map((id) => serviceConfigOf(id));

    // Assert
    expect(new Set(entries).size).toBe(COMMUTE_IDS.length);
    expect(new Set(entries.map((entry) => entry?.notices)).size).toBe(COMMUTE_IDS.length);
  });
});
