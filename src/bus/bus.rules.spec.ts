/**
 * The bus module's shared rules: a parsed config is frozen deep so no request
 * can change it, and a service id resolves only to SERVICE_CONFIG's own keys.
 * The TOPIS key's format check is src/infra/required-env.spec.ts's.
 */
import { deepFreeze, serviceConfigOf } from "./bus.rules";

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

  it("makes a nested Map refuse set, delete and clear, keeping its entries and freezing their values", () => {
    // Arrange
    const value = { byId: new Map([["a", { name: "x" }]]) };

    // Act
    deepFreeze(value);

    // Assert
    expect(() => value.byId.set("b", { name: "y" })).toThrow(TypeError);
    expect(() => value.byId.delete("a")).toThrow(TypeError);
    expect(() => value.byId.clear()).toThrow(TypeError);
    expect([...value.byId]).toEqual([["a", { name: "x" }]]);
    expect(Object.isFrozen(value.byId.get("a"))).toBe(true);
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

  it("gives each its own entry, so changing one leaves the others", () => {
    // Act
    const entries = COMMUTE_IDS.map((id) => serviceConfigOf(id));

    // Assert
    expect(new Set(entries).size).toBe(COMMUTE_IDS.length);
    expect(new Set(entries.map((entry) => entry?.eta)).size).toBe(COMMUTE_IDS.length);
  });
});
