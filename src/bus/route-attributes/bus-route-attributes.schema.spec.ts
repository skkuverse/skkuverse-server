/**
 * jongroRouteAttributesDataset, the shape of the `jongro-route-attributes`
 * dataset (move-reference-datasets D10): each Jongro route's card, refresh
 * interval, seat count and transfer lines, keyed by route id. A push is refused
 * on it and the read parses with it. Revision 1 (the fixture) passes as it is;
 * each check the committed jongro-routes.json was refused on is refused at its
 * path, under `routes.<routeId>`. storedRouteAttributes, the stored document as
 * the repository reads it, needs its revision and data.
 */
import { routeAttributesFixture as storedFixture } from "../../../__tests__/helpers/bus/route-attributes";
import { jongroRouteAttributesDataset, storedRouteAttributes } from "./bus-route-attributes.schema";

// The fixture as untyped JSON, so a test can break its shape.
const fixture = (): Record<string, any> => storedFixture();

function messagesOf(raw: unknown): string[] {
  const result = jongroRouteAttributesDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const withJongro07 = (patch: Record<string, unknown>): Record<string, any> => {
  const data = fixture();
  data.routes.jongro07 = { ...data.routes.jongro07, ...patch };
  return data;
};

describe("jongroRouteAttributesDataset", () => {
  it("passes revision 1 as it is, in its order", () => {
    // Act
    const parsed = jongroRouteAttributesDataset.parse(fixture());

    // Assert
    expect(parsed).toEqual(fixture());
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(fixture()));
  });

  it("fails a copy without routes", () => {
    // Act & Assert
    expect(messagesOf({})).toEqual(["routes: Invalid input: expected record, received undefined"]);
  });

  it.each(Object.keys(storedFixture().routes.jongro07!))("fails a route without %s, naming the route", (field) => {
    // Arrange
    const data = fixture();
    delete data.routes.jongro07[field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^routes\\.jongro07\\.${field}: `))]);
  });

  it("fails a field the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf(withJongro07({ busRouteId: "100900004" }))).toEqual(['routes.jongro07: Unrecognized key: "busRouteId"']);
  });

  it.each([
    ["a theme color off hex", { themeColor: "green" }, "routes.jongro07.themeColor: must be 6-char hex string"],
    ["a theme color with a hash", { themeColor: "#4CAF50" }, "routes.jongro07.themeColor: must be 6-char hex string"],
    ["an empty icon type", { iconType: "" }, "routes.jongro07.iconType: required non-empty string"],
    ["a refresh interval of 0", { refreshInterval: 0 }, "routes.jongro07.refreshInterval: required positive number"],
    ["a negative refresh interval", { refreshInterval: -25 }, "routes.jongro07.refreshInterval: required positive number"],
    ["a seat count of 0", { seatCount: 0 }, "routes.jongro07.seatCount: required positive integer"],
    ["a negative seat count", { seatCount: -18 }, "routes.jongro07.seatCount: required positive integer"],
    ["a fractional seat count", { seatCount: 17.5 }, "routes.jongro07.seatCount: required positive integer"],
  ])("fails %s, naming its path", (_case, patch, message) => {
    // Act & Assert
    expect(messagesOf(withJongro07(patch))).toEqual([message]);
  });

  it.each([
    ["a refresh interval of 1", { refreshInterval: 1 }],
    ["a seat count of 1", { seatCount: 1 }],
    ["a route without transfer lines", { transferLinesByArsId: {} }],
  ])("passes %s", (_case, patch) => {
    // Act & Assert
    expect(messagesOf(withJongro07(patch))).toEqual([]);
  });

  it.each([
    ["an empty list", { "01589": [] }, ["routes.jongro07.transferLinesByArsId.01589: required non-empty array"]],
    ["a line without a name", { "01589": [{ line: "", color: "0052A4" }] }, ["routes.jongro07.transferLinesByArsId.01589.0.line: required non-empty string"]],
    ["a color off hex", { "01589": [{ line: "1", color: "blue" }] }, ["routes.jongro07.transferLinesByArsId.01589.0.color: must be 6-char hex string"]],
    ["an empty ARS number", { "": [{ line: "1", color: "0052A4" }] }, ["routes.jongro07.transferLinesByArsId.: ARS number must be a non-empty string"]],
    ["a line missing its color", { "01589": [{ line: "1" }] }, ["routes.jongro07.transferLinesByArsId.01589.0.color: Invalid input: expected string, received undefined"]],
  ])("fails a transfer line with %s, naming its path", (_case, transferLinesByArsId, expected) => {
    // Act & Assert
    expect(messagesOf(withJongro07({ transferLinesByArsId }))).toEqual(expected);
  });

  it("fails every faulty route in one parse, each at its path", () => {
    // Arrange
    const data = withJongro07({ seatCount: 0 });
    data.routes.jongro08.themeColor = "zz";

    // Act & Assert
    expect(messagesOf(data)).toEqual(["routes.jongro07.seatCount: required positive integer", "routes.jongro08.themeColor: must be 6-char hex string"]);
  });
});

describe("storedRouteAttributes", () => {
  it("passes a stored document's revision and data", () => {
    // Act
    const parsed = storedRouteAttributes.parse({ revision: 3, data: fixture() });

    // Assert
    expect(parsed).toEqual({ revision: 3, data: fixture() });
  });

  it.each([["revision"], ["data"]])("fails a document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 3, data: fixture() };
    delete doc[field];

    // Act
    const result = storedRouteAttributes.safeParse(doc);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});
