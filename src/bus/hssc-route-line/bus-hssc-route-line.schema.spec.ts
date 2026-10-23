/**
 * hsscRouteLineDataset, the shape of the `hssc-route-line` dataset: the HSSC loop as `[lng, lat]` positions. A push
 * is refused on it and the read parses with it. Revision 1 (the fixture, measured 2026-10-23) passes as it is; a
 * copy without `path`, with a key the dataset does not hold, with too few points or with a position outside the
 * globe's ranges (a swapped `[lat, lng]` pair lands there) fails at its path. storedHsscRouteLine, the stored
 * document as the repository reads it, needs its revision and data.
 */
import { hsscRouteLineFixture } from "../../../__tests__/helpers/bus/hssc-route-line";
import { MIN_ROUTE_LINE_POINTS } from "./bus-hssc-route-line.constants";
import { hsscRouteLineDataset, storedHsscRouteLine } from "./bus-hssc-route-line.schema";

function messagesOf(raw: unknown): string[] {
  const result = hsscRouteLineDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("hsscRouteLineDataset", () => {
  it("passes revision 1 as it is", () => {
    // Act
    const parsed = hsscRouteLineDataset.parse(hsscRouteLineFixture());

    // Assert
    expect(parsed).toEqual(hsscRouteLineFixture());
    expect(parsed.path).toHaveLength(235);
  });

  it("fails a copy without path", () => {
    // Act & Assert
    expect(messagesOf({})).toEqual([expect.stringMatching(/^path: /)]);
  });

  it("fails a key the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ ...hsscRouteLineFixture(), color: "003626" })).toEqual([': Unrecognized key: "color"']);
  });

  it.each([
    ["one below the minimum fails", MIN_ROUTE_LINE_POINTS - 1, 1],
    ["the minimum passes", MIN_ROUTE_LINE_POINTS, 0],
  ])("Point count: %s", (_label, count, issueCount) => {
    // Arrange
    const path = hsscRouteLineFixture().path.slice(0, count);

    // Act & Assert
    expect(messagesOf({ path })).toHaveLength(issueCount);
  });

  it.each([
    ["a swapped [lat, lng] pair", [37.587807, 126.992374], "path.3.1"],
    ["a longitude past 180", [181, 37.587807], "path.3.0"],
    ["a latitude below -90", [126.992374, -91], "path.3.1"],
  ])("fails %s, naming the position", (_label, position, at) => {
    // Arrange
    const line = hsscRouteLineFixture();
    line.path[3] = position as [number, number];

    // Act & Assert
    expect(messagesOf(line)).toEqual([expect.stringMatching(new RegExp(`^${at.replace(/\./g, "\\.")}: `))]);
  });

  it("fails a position of three numbers", () => {
    // Arrange
    const line = hsscRouteLineFixture() as { path: number[][] };
    line.path[3] = [126.992374, 37.587807, 40];

    // Act & Assert
    expect(messagesOf(line)).toEqual([expect.stringMatching(/^path\.3: /)]);
  });
});

describe("storedHsscRouteLine", () => {
  it("parses a stored document's revision and data", () => {
    // Act
    const parsed = storedHsscRouteLine.parse({ revision: 2, data: hsscRouteLineFixture() });

    // Assert
    expect(parsed).toEqual({ revision: 2, data: hsscRouteLineFixture() });
  });

  it.each(["revision", "data"])("fails a stored document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 2, data: hsscRouteLineFixture() };
    delete doc[field];

    // Act & Assert
    expect(storedHsscRouteLine.safeParse(doc).success).toBe(false);
  });
});
