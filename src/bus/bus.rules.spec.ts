/**
 * The bus module's shared rules: a parsed config is frozen deep so no request
 * can change it, a service id resolves only to SERVICE_CONFIG's own keys, and
 * a TOPIS pole's stop id is the local stop aliasing it, else `seoul-<arsId>`,
 * and none for a virtual stop, which
 * the stop index and the realtime stations of `/bus/config` both serve. Ported
 * (old → new): `toTopisStopId` "prefixes the ARS number" of
 * src/bus/stop-index/bus-stop-index.rules.spec.ts is the first case below.
 * The TOPIS key's format check is src/infra/required-env.spec.ts's.
 */
import { deepFreeze, serviceConfigOf, toPoleStopId } from "./bus.rules";

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

  // WHY: a frozen parent is not taken as already deep-frozen, or a Map inside keeps working mutators.
  it("locks a Map and freezes an object inside a parent frozen before deepFreeze saw it", () => {
    // Arrange
    const value = Object.freeze({ byId: new Map([["a", { name: "x" }]]), nested: { name: "y" } });

    // Act
    deepFreeze(value);

    // Assert
    expect(() => value.byId.set("b", { name: "z" })).toThrow(TypeError);
    expect(Object.isFrozen(value.byId.get("a"))).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
  });

  it.each([
    ["Map", () => Object.freeze(new Map([["a", 1]]))],
    ["Set", () => Object.freeze(new Set(["a"]))],
  ])("refuses a %s frozen before deepFreeze could lock it, since its entries could still change", (_kind, collection) => {
    // Act & Assert
    expect(() => deepFreeze({ ids: collection() })).toThrow(TypeError);
  });

  it("freezes a locked Map again, and a cycle, without throwing", () => {
    // Arrange
    const value: { byId: Map<string, unknown>; self?: unknown } = { byId: new Map([["a", { name: "x" }]]) };
    value.self = value;
    deepFreeze(value);

    // Act & Assert
    expect(() => deepFreeze(value)).not.toThrow();
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

describe("toPoleStopId", () => {
  const NO_ALIASES = new Map<string, string>();

  it.each([
    ["01592", "seoul-01592"],
    ["00001", "seoul-00001"],
    ["0", null],
    ["00000", null],
    ["", null],
    ["1592", null],
    ["015920", null],
    [null, null],
  ])("gives the ARS number %s the stop id %s", (arsId, stopId) => {
    // Act & Assert
    expect(toPoleStopId(arsId, NO_ALIASES)).toBe(stopId);
  });

  it("gives an aliased pole its local stop's id, and every other pole its own", () => {
    // Arrange
    const aliases = new Map([["01618", "hssc-bus-lot"]]);

    // Act & Assert
    expect(toPoleStopId("01618", aliases)).toBe("hssc-bus-lot");
    expect(toPoleStopId("01616", aliases)).toBe("seoul-01616");
  });

  it("gives a virtual stop no id even when an alias names it", () => {
    // Arrange
    const aliases = new Map([["00000", "hssc-bus-lot"]]);

    // Act & Assert
    expect(toPoleStopId("00000", aliases)).toBeNull();
  });
});
