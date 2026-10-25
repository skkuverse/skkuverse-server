/**
 * The bus module's shared rules: a parsed config is frozen deep so no request
 * can change it, a service id resolves only to SERVICE_CONFIG's own keys, and
 * a TOPIS pole's stop id is the local stop aliasing it, else its national
 * nine-digit station id (owner, 2026-10-25; it was `seoul-<arsId>` before,
 * now a legacy alias), and none for a virtual stop, which
 * the stop index and the realtime stations of `/bus/config` both serve. Ported
 * (old → new): `toTopisStopId` "prefixes the ARS number" of
 * src/bus/stop-index/bus-stop-index.rules.spec.ts is the first case below.
 * The TOPIS key's format check is src/infra/required-env.spec.ts's. The HSSC
 * line passes through the Hyehwa Rotary at positions 5 and 7, the stored line's
 * null stops and the positions the HSSC estimates skip. A TOPIS route passes
 * through each station named `…(미정차)`, whatever ARS number its row carries:
 * 19 of 7800's 80 in the 2026-10-24 capture, none of the Jongro routes'.
 * Where an HSSC station heads (the next position with a stop, round the loop)
 * and whether riders board or only get off there, which the stop page and the
 * stop list both serve: toTowards moved here unchanged from
 * src/bus/stop-arrivals/bus-stop-arrivals.rules.spec.ts.
 * Which stop area holds each stop (ADR 0022, D4), which the bus-stops checks
 * and the stop index both read: the first area listing a stop holds it, and a
 * member that resolves to no stop, or to one an area holds already, is left out.
 */
import arrivals7800 from "../../__tests__/nest/bus/fixtures/topis-7800-arrivals.json";
import registryRoutes from "../../__tests__/nest/bus/fixtures/jongro-registry-routes.json";
import { deepFreeze, isHsscPassThrough, isTopisPassThrough, serviceConfigOf, toPoleStopId, toServedArsId, toStationAction, toStationStopId, toStopAreaMembership, toTowards } from "./bus.rules";

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

// WHY: the live route shows a pole's number on its sign and nothing for a virtual stop (ADR 0019, D5).
describe("isHsscPassThrough", () => {
  it.each([
    [4, false],
    [5, true],
    [6, false],
    [7, true],
    [8, false],
    [0, false],
    [10, false],
  ])("position %i → %s", (stationIndex, expected) => {
    // Act & Assert
    expect(isHsscPassThrough(stationIndex)).toBe(expected);
  });
});

describe("isTopisPassThrough", () => {
  it.each([
    ["효행공원(미정차)", true],
    [" 사당역사거리(미정차) ", true],
    ["성균관대학교", false],
    ["미정차정류장", false],
    ["(미정차)앞", false],
    ["혜화동로터리 [미정차]", false],
  ])("%j → %s", (stationName, expected) => {
    // Act & Assert
    expect(isTopisPassThrough(stationName)).toBe(expected);
  });

  it("passes through 7800's 19 virtual stations, three of which carry an ARS number", () => {
    // Arrange
    const rows = arrivals7800.msgBody.itemList;

    // Act
    const passed = rows.filter((row) => isTopisPassThrough(row.stNm));

    // Assert
    expect(passed.map((row) => Number(row.staOrd))).toEqual([28, 29, 30, 32, 33, 34, 35, 36, 40, 42, 43, 45, 46, 47, 48, 49, 51, 52, 53]);
    expect(passed.filter((row) => row.arsId !== "0").map((row) => row.arsId)).toEqual(["78420", "78155", "78352"]);
  });

  it("passes through none of the stored Jongro stations", () => {
    // Act & Assert
    expect(registryRoutes.routes.flatMap((route) => route.stations).filter((station) => isTopisPassThrough(station.stationName))).toEqual([]);
  });
});

describe("toServedArsId", () => {
  it.each([
    ["01592", "01592"],
    ["0", null],
    ["00000", null],
    ["1592", null],
    [null, null],
  ])("%j → %j", (arsId, expected) => {
    // Act & Assert
    expect(toServedArsId(arsId)).toBe(expected);
  });
});

describe("toPoleStopId", () => {
  const NO_ALIASES = new Map<string, string>();
  const pole = (arsId: string | null, topisId = "100900075") => ({ arsId, topisId });

  it.each([
    ["01592", "100900075"],
    ["00001", "100900075"],
    ["0", null],
    ["00000", null],
    ["", null],
    ["1592", null],
    ["015920", null],
    [null, null],
  ])("gives the pole 100900075 with the ARS number %s the stop id %s", (arsId, stopId) => {
    // Act & Assert
    expect(toPoleStopId(pole(arsId), NO_ALIASES)).toBe(stopId);
  });

  it("gives an aliased pole its local stop's id, and every other pole its own", () => {
    // Arrange
    const aliases = new Map([["01618", "hssc-bus-lot"]]);

    // Act & Assert
    expect(toPoleStopId(pole("01618", "100900221"), aliases)).toBe("hssc-bus-lot");
    expect(toPoleStopId(pole("01616", "100900219"), aliases)).toBe("100900219");
  });

  it("gives a virtual stop no id even when an alias names it", () => {
    // Arrange
    const aliases = new Map([["00000", "hssc-bus-lot"]]);

    // Act & Assert
    expect(toPoleStopId(pole("00000"), aliases)).toBeNull();
  });
});

describe("toStationStopId", () => {
  const aliases = {
    stopIdByArsId: new Map([
      ["20253", "sadang-exit9"],
      ["01618", "hssc-600th"],
    ]),
    stopIdByTopisId: new Map([
      ["200000162", "nsc-skku-to-sadang"],
      ["100900221", "hssc-bus-lot"],
    ]),
  };

  it.each([
    ["a TOPIS alias of a pole with no ARS number", "0", "200000162", true, "nsc-skku-to-sadang"],
    ["a TOPIS alias over another stop's ARS alias", "01618", "100900221", true, "hssc-bus-lot"],
    ["an ARS alias", "20253", "119000302", true, "sadang-exit9"],
    ["an unaliased pole of a listed route", "27113", "203000101", true, "203000101"],
    ["a virtual stop of a listed route", "0", "201000404", true, null],
    ["a TOPIS alias on an unlisted route", "0", "200000162", false, "nsc-skku-to-sadang"],
    ["an ARS alias on an unlisted route", "20253", "119000302", false, "sadang-exit9"],
    ["an unaliased pole of an unlisted route", "27113", "203000101", false, null],
  ])("gives %s the stop id %s", (_case, arsId, topisId, isListed, stopId) => {
    // Act & Assert
    expect(toStationStopId({ arsId, topisId }, aliases, isListed)).toBe(stopId);
  });
});

describe("toStationStopId by national station id", () => {
  const NO_ALIASES = { stopIdByArsId: new Map<string, string>(), stopIdByTopisId: new Map<string, string>() };

  it("names an unaliased pole of a listed route by its nine-digit station id, never by its ARS number", () => {
    // Act & Assert
    expect(toStationStopId({ arsId: "01592", topisId: "100900075" }, NO_ALIASES, true)).toBe("100900075");
  });

  it("keeps two poles that share an ARS number apart, as 01013 is both 종로2가 and 수원 성균관대학교", () => {
    // Act
    const stopIds = [toStationStopId({ arsId: "01013", topisId: "100000013" }, NO_ALIASES, true), toStationStopId({ arsId: "01013", topisId: "200000104" }, NO_ALIASES, true)];

    // Assert
    expect(stopIds).toEqual(["100000013", "200000104"]);
  });
});

describe("toTowards", () => {
  const station = (name: string, stopId: string | null) => ({ name, stopId });
  const line = [station("농구장", "a"), station("600주년(하교)", "b"), station("혜화동로터리", null), station("혜화역", "c")];

  it.each([
    [0, "600주년(하교)"],
    [1, "혜화역"],
    [3, "농구장"],
  ])("station %i heads towards %s, the next with a stop round the loop", (stationIndex, expected) => {
    // Act & Assert
    expect(toTowards(line, stationIndex)).toBe(expected);
  });

  it("answers null on a line with no other stop", () => {
    // Act & Assert
    expect(toTowards([station("농구장", "a"), station("로터리", null)], 0)).toBeNull();
  });
});

describe("toStationAction", () => {
  it.each([
    ["a drop-off-only station", { isAlightOnly: true }, "alight"],
    ["a station flagged false", { isAlightOnly: false }, "board"],
    ["a station stored without the flag", {}, "board"],
    ["no station, as on a Jongno route", undefined, "board"],
  ])("riders at %s: %s", (_case, station, expected) => {
    // Act & Assert
    expect(toStationAction(station)).toBe(expected);
  });
});

describe("toStopAreaMembership", () => {
  const stopIdByMemberId = new Map([
    ["hssc-bus-lot", "hssc-bus-lot"],
    ["seoul-01618", "hssc-bus-lot"],
    ["hssc-600th", "hssc-600th"],
    ["seoul-01592", "100900075"],
  ]);
  const stopIdOf = (memberId: string): string | null => stopIdByMemberId.get(memberId) ?? null;

  it("files each resolved member's stop under its area and leaves none out", () => {
    // Act
    const membership = toStopAreaMembership([{ id: "hssc-lot", stopIds: ["seoul-01618", "hssc-600th"] }], stopIdOf);

    // Assert
    expect([...membership.stopAreaIdByStopId]).toEqual([
      ["hssc-bus-lot", "hssc-lot"],
      ["hssc-600th", "hssc-lot"],
    ]);
    expect(membership.heldMembers).toEqual([
      { areaIndex: 0, memberIndex: 0, stopId: "hssc-bus-lot" },
      { areaIndex: 0, memberIndex: 1, stopId: "hssc-600th" },
    ]);
    expect(membership.leftOutMembers).toEqual([]);
  });

  it("leaves out a member that resolves to no stop, one its own area lists already, and one an earlier area holds", () => {
    // Arrange
    const stopAreas = [
      { id: "first", stopIds: ["hssc-bus-lot", "seoul-99999", "seoul-01618"] },
      { id: "second", stopIds: ["seoul-01592", "hssc-bus-lot"] },
    ];

    // Act
    const membership = toStopAreaMembership(stopAreas, stopIdOf);

    // Assert
    expect([...membership.stopAreaIdByStopId]).toEqual([
      ["hssc-bus-lot", "first"],
      ["100900075", "second"],
    ]);
    expect(membership.heldMembers.map(({ areaIndex, memberIndex }) => [areaIndex, memberIndex])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(membership.leftOutMembers).toEqual([
      { stopAreaId: "first", areaIndex: 0, memberIndex: 1, memberId: "seoul-99999", stopId: null, heldBy: null },
      { stopAreaId: "first", areaIndex: 0, memberIndex: 2, memberId: "seoul-01618", stopId: "hssc-bus-lot", heldBy: "first" },
      { stopAreaId: "second", areaIndex: 1, memberIndex: 1, memberId: "hssc-bus-lot", stopId: "hssc-bus-lot", heldBy: "first" },
    ]);
  });
});
