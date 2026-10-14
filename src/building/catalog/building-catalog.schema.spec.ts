/**
 * The catalog's request schemas: GET /building/list reads campus as optional
 * (an empty value is no filter, a repeated one is rejected), and
 * /building/:skkuId reads the id with parseInt and rejects anything that does
 * not read as a positive safe integer, with the message the 400 shows. A
 * stored connection parses with both ends, each a valid skkuId and a floor in
 * Korean and English, kept as stored.
 */
import { buildingListQuery, connectionEnds, skkuIdParam } from "./building-catalog.schema";

describe("building catalog schemas", () => {
  it("read campus as optional, an empty value as absent", () => {
    // Act & Assert
    expect(buildingListQuery.parse({})).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "" })).toEqual({ campus: undefined });
    expect(buildingListQuery.parse({ campus: "nsc", other: "x" })).toEqual({ campus: "nsc" });
    expect(buildingListQuery.safeParse({ campus: ["hssc", "nsc"] }).success).toBe(false);
  });

  it.each([
    ["1", 1],
    ["12abc", 12],
    ["1.9", 1],
    [" 7", 7],
  ])("read skkuId %j with parseInt as %d", (raw, id) => {
    // Act & Assert
    expect(skkuIdParam.parse(raw)).toBe(id);
  });

  it.each(["0", "-3", "abc", "", "0x10"])("reject skkuId %j", (raw) => {
    // Act
    const result = skkuIdParam.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("skkuId must be a positive integer");
  });
});

describe("skkuIdParam at the safe-integer limit", () => {
  it("reads the largest safe integer as itself", () => {
    // Act & Assert
    expect(skkuIdParam.parse("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ["an id too long for a double, which parseInt reads as Infinity", "9".repeat(400)],
    ["2^53 + 1, which parseInt rounds to 2^53", "9007199254740993"],
  ])("rejects %s", (_case, raw) => {
    // Act
    const result = skkuIdParam.safeParse(raw);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("skkuId must be a positive integer");
  });
});

describe("connectionEnds", () => {
  const CONNECTION = { a: { skkuId: 2, floor: { ko: "2층", en: "2F" } }, b: { skkuId: 3, floor: { ko: "3층", en: "3F" } } };

  it("parses a seeded connection as stored, extra fields kept", () => {
    // Arrange
    const stored = { ...CONNECTION, a: { ...CONNECTION.a, floor: { ...CONNECTION.a.floor, zh: "2楼" }, note: "x" } };

    // Act & Assert
    expect(connectionEnds.parse(stored)).toEqual(stored);
  });

  it.each(Object.keys(connectionEnds.shape))("rejects a connection without %s", (end) => {
    // Arrange
    const connection: Record<string, unknown> = { ...CONNECTION };
    delete connection[end];

    // Act & Assert
    expect(connectionEnds.safeParse(connection).success).toBe(false);
  });

  it.each([
    ["an end without skkuId", { ...CONNECTION, a: { floor: CONNECTION.a.floor } }],
    ["an end whose skkuId is not a positive integer", { ...CONNECTION, b: { ...CONNECTION.b, skkuId: 0 } }],
    ["an end without a floor", { ...CONNECTION, a: { skkuId: 2 } }],
    ["a floor without English", { ...CONNECTION, b: { ...CONNECTION.b, floor: { ko: "3층" } } }],
  ])("rejects %s", (_case, stored) => {
    // Act & Assert
    expect(connectionEnds.safeParse(stored).success).toBe(false);
  });
});

describe("connectionEnds against what scripts/seed-connections.js writes", () => {
  // The seed is CommonJS outside tsconfig, so it is required. Its skkuIds come from the buildings
  // collection; production's 11 seeded rows hold 2, 3, 9, 10, 11, 12, 13 and 14 (2026-10-14).
  const { CONNECTIONS, toConnectionDoc } = require("../../../scripts/lib/connections-seed");
  const SEEDED: Array<[string, unknown]> = CONNECTIONS.map((row: { a: string; b: string }) => [`${row.a} ↔ ${row.b}`, row]);

  it.each(SEEDED)(
    "parses the seeded %s as written",
    (_name, row) => {
      // Arrange
      const written = toConnectionDoc(row, 10, 11);

      // Act & Assert
      expect(connectionEnds.parse(written)).toEqual({ a: written.a, b: written.b });
    },
  );
});

