/**
 * jongroRoutesConfig, the refined form of the jongro-routes.json wire: the
 * committed file passes; a copy missing any field of a route or a station
 * fails; and the cross-checks name what broke: the route id pattern, a
 * duplicate id, a duplicate stop (the loop-closing repeat aside), hex colors
 * and the first and last markers at the two ends.
 */
import { jongroRoutesConfig } from "./bus.schema";

const committed = require("./jongro-routes.json") as Array<Record<string, unknown> & { stations: Array<Record<string, unknown>> }>;

const stn = (topisId: string, first = false, last = false) => ({
  stationName: topisId,
  arsId: topisId,
  topisId,
  isFirstStation: first,
  isLastStation: last,
  isRotationStation: false,
  transferLines: [] as Array<{ line: string; color: string }>,
});
const route = (stations: unknown[], overrides: Record<string, unknown> = {}) => ({
  id: "jongro99",
  busRouteId: "1",
  themeColor: "4CAF50",
  iconType: "village",
  refreshInterval: 40,
  stations,
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

  it.each(Object.keys(committed[0]!.stations[0]!))("rejects a station without %s", (field) => {
    // Arrange
    const [first, ...others] = committed[0]!.stations;
    const rest = Object.fromEntries(Object.entries(first!).filter(([key]) => key !== field));

    // Act & Assert
    expect(messagesOf([{ ...committed[0], stations: [rest, ...others] }]).length).toBeGreaterThan(0);
  });

  it.each([
    ["an id off the pattern", [route([stn("A", true), stn("B", false, true)], { id: "jongro007" })], "0.id: must match"],
    ["a repeated id", [route([stn("A", true), stn("B", false, true)]), route([stn("A", true), stn("B", false, true)])], '1.id: duplicate "jongro99"'],
    ["a theme color off hex", [route([stn("A", true), stn("B", false, true)], { themeColor: "green" })], "0.themeColor: must be 6-char hex string"],
    ["no stations", [route([])], "0.stations: required non-empty array"],
    ["a stop repeated mid-route", [route([stn("A", true), stn("B"), stn("B", false, true)])], '0.stations.2.topisId: duplicate "B" within route'],
    ["no first marker", [route([stn("A"), stn("B", false, true)])], "0: must have exactly 1 isFirstStation=true (got 0)"],
    ["a first marker off index 0", [route([stn("A"), stn("B", true), stn("C", false, true)])], "0: isFirstStation=true must be at index 0 (got 1)"],
    ["a last marker off the end", [route([stn("A", true), stn("B", false, true), stn("C")])], "0: isLastStation=true must be at index 2 (got 1)"],
  ])("rejects %s", (_case, raw, message) => {
    // Act & Assert
    expect(messagesOf(raw)).toContainEqual(expect.stringContaining(message));
  });

  it("accepts the last stop repeating the first (TOPIS loop close)", () => {
    // Act & Assert
    expect(messagesOf([route([stn("A", true), stn("B"), stn("A", false, true)])])).toEqual([]);
  });
});

// WHY: zod runs a superRefine only once every type check has passed, so a file with both kinds of fault
// fails the boot on its type issues, and on its cross-check issues at the next boot. Accepted (PR 250 F5).
describe("jongroRoutesConfig with several faults", () => {
  const typeFaults = () => [route([stn("1", true, true)], { busRouteId: 1 }), route([{ ...stn("2", true, true), stationName: 2 }], { id: "jongro98" })];
  const crossFaults = () => [route([stn("1", true, true)], { id: "bad" }), route([stn("2", true, true)], { id: "jongro98", themeColor: "zz" })];

  it("reports every type fault in one boot", () => {
    // Act & Assert
    expect(messagesOf(typeFaults())).toEqual([
      "0.busRouteId: Invalid input: expected string, received number",
      "1.stations.0.stationName: Invalid input: expected string, received number",
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
      "1.stations.0.stationName: Invalid input: expected string, received number",
    ]);
  });
});
