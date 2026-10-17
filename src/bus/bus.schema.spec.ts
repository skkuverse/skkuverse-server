/**
 * jongroRoutesConfig, the refined form of the jongro-routes.json wire: the
 * committed file passes; a copy missing any field of a route fails; and the
 * cross-checks name what broke: the route id pattern, a duplicate id, hex
 * colors and a malformed transfer override. The stations moved to the
 * registry's snapshot (src/bus/registry/, improve-jongro-realtime D6).
 */
import { jongroRoutesConfig } from "./bus.schema";

const committed = require("./jongro-routes.json") as Array<Record<string, unknown>>;

const route = (overrides: Record<string, unknown> = {}) => ({
  id: "jongro99",
  busRouteId: "1",
  themeColor: "4CAF50",
  iconType: "village",
  refreshInterval: 40,
  seatCount: 18,
  transferLinesByArsId: { "01589": [{ line: "1", color: "0052A4" }] },
  ...overrides,
});

function messagesOf(raw: unknown): string[] {
  const result = jongroRoutesConfig.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("jongroRoutesConfig", () => {
  it("accepts the committed jongro-routes.json", () => {
    // Act & Assert
    expect(messagesOf(committed)).toEqual([]);
  });

  it.each(Object.keys(committed[0]!))("rejects a route without %s", (field) => {
    // Arrange
    const rest = Object.fromEntries(Object.entries(committed[0]!).filter(([key]) => key !== field));

    // Act & Assert
    expect(messagesOf([rest]).length).toBeGreaterThan(0);
  });

  it.each([
    ["an id off the pattern", [route({ id: "jongro007" })], "0.id: must match"],
    ["a repeated id", [route(), route()], '1.id: duplicate "jongro99"'],
    ["a theme color off hex", [route({ themeColor: "green" })], "0.themeColor: must be 6-char hex string"],
  ])("rejects %s", (_case, raw, message) => {
    // Act & Assert
    expect(messagesOf(raw)).toContainEqual(expect.stringContaining(message));
  });

  it("accepts a route without transfer lines", () => {
    // Act & Assert
    expect(messagesOf([route({ transferLinesByArsId: {} })])).toEqual([]);
  });
});

// WHY: a station's transfer lines come from this override by ARS number, so a malformed one fails the boot
// with its ARS number in the path (improve-jongro-realtime D6).
describe("jongroRoutesConfig transferLinesByArsId", () => {
  it.each([
    ["an empty list", { "01589": [] }, ["0.transferLinesByArsId.01589: required non-empty array"]],
    ["a line without a name", { "01589": [{ line: "", color: "0052A4" }] }, ["0.transferLinesByArsId.01589.0.line: required non-empty string"]],
    ["a color off hex", { "01589": [{ line: "1", color: "blue" }] }, ["0.transferLinesByArsId.01589.0.color: must be 6-char hex string"]],
    ["an empty ARS number", { "": [{ line: "1", color: "0052A4" }] }, ["0.transferLinesByArsId.: ARS number must be a non-empty string"]],
  ])("rejects %s", (_case, transferLinesByArsId, expected) => {
    // Act & Assert
    expect(messagesOf([route({ transferLinesByArsId })])).toEqual(expected);
  });

  it("rejects a line missing its color as a type fault", () => {
    // Act & Assert
    expect(messagesOf([route({ transferLinesByArsId: { "01589": [{ line: "1" }] } })])).toEqual([
      "0.transferLinesByArsId.01589.0.color: Invalid input: expected string, received undefined",
    ]);
  });
});

// WHY: crowding compares a bus's passenger count with its route's seat count, so a route without a usable one
// fails the boot, named by its path (improve-jongro-realtime D5).
describe("jongroRoutesConfig seatCount", () => {
  it("rejects a route without a seat count, naming it", () => {
    // Arrange
    const withoutSeatCount = Object.fromEntries(Object.entries(route()).filter(([key]) => key !== "seatCount"));

    // Act & Assert
    expect(messagesOf([route({ id: "jongro98" }), withoutSeatCount])).toEqual([
      "1.seatCount: Invalid input: expected number, received undefined",
    ]);
  });

  it.each([[0], [-18], [17.5]])("rejects a seat count of %j, naming the route", (seatCount) => {
    // Act & Assert
    expect(messagesOf([route({ seatCount })])).toEqual(["0.seatCount: required positive integer"]);
  });

  it("accepts a seat count of 1", () => {
    // Act & Assert
    expect(messagesOf([route({ seatCount: 1 })])).toEqual([]);
  });
});

// WHY: zod runs a superRefine only once every type check has passed, so a file with both kinds of fault
// fails the boot on its type issues, and on its cross-check issues at the next boot. Accepted (PR 250 F5).
describe("jongroRoutesConfig with several faults", () => {
  const typeFaults = () => [route({ busRouteId: 1 }), route({ id: "jongro98", transferLinesByArsId: { "01589": [{ line: 2, color: "0052A4" }] } })];
  const crossFaults = () => [route({ id: "bad" }), route({ id: "jongro98", themeColor: "zz" })];

  it("reports every type fault in one boot", () => {
    // Act & Assert
    expect(messagesOf(typeFaults())).toEqual([
      "0.busRouteId: Invalid input: expected string, received number",
      "1.transferLinesByArsId.01589.0.line: Invalid input: expected string, received number",
    ]);
  });

  it("reports every cross-check fault in one boot", () => {
    // Act & Assert
    expect(messagesOf(crossFaults())).toEqual(["0.id: must match /^jongro(0[1-9]|[1-9]\\d+)$/", "1.themeColor: must be 6-char hex string"]);
  });

  it("reports only the type faults of a file that has both kinds", () => {
    // Act & Assert
    expect(messagesOf([...typeFaults(), ...crossFaults()])).toEqual([
      "0.busRouteId: Invalid input: expected string, received number",
      "1.transferLinesByArsId.01589.0.line: Invalid input: expected string, received number",
    ]);
  });
});
