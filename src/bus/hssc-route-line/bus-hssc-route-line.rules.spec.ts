/**
 * toRouteLineIssues, the checks a schema cannot hold that `npm run data` refuses an `hssc-route-line` push on: the
 * line is a loop, so its last point repeats its first, and no segment is longer than MAX_ROUTE_LINE_SEGMENT_M, which
 * catches a stray point. Revision 1 has no issue.
 */
import { hsscRouteLineFixture } from "../../../__tests__/helpers/bus/hssc-route-line";
import type { Position } from "../../shared/geojson.types";
import { MAX_ROUTE_LINE_SEGMENT_M } from "./bus-hssc-route-line.constants";
import { toRouteLineIssues } from "./bus-hssc-route-line.rules";

// 1e-5 deg of latitude is about 1.1119 m; a segment due north of `from` this many meters long.
const METERS_PER_DEGREE_LAT = 111_195;
const north = (from: Position, meters: number): Position => [from[0], from[1] + meters / METERS_PER_DEGREE_LAT];

/** A closed square-ish loop whose first segment is `firstSegmentM` long and every other one short. */
function loopWithFirstSegment(firstSegmentM: number): { path: Position[] } {
  const start: Position = [126.99, 37.58];
  const top = north(start, firstSegmentM);
  const corners: Position[] = [start, top, [top[0] + 0.0001, top[1]], [start[0] + 0.0001, start[1] + 0.0005]];
  const path: Position[] = [];
  for (let i = 0; i < corners.length; i++) {
    const [a, b] = [corners[i]!, corners[(i + 1) % corners.length]!];
    const steps = i === 0 ? 1 : Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.0004);
    for (let k = 0; k < steps; k++) path.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  }
  path.push(start);
  return { path };
}

describe("toRouteLineIssues", () => {
  it("finds no issue in revision 1", () => {
    // Act & Assert
    expect(toRouteLineIssues(hsscRouteLineFixture())).toEqual([]);
  });

  it("refuses an open loop, naming the last point", () => {
    // Arrange
    const line = hsscRouteLineFixture();
    line.path.pop();

    // Act
    const issues = toRouteLineIssues(line);

    // Assert
    expect(issues).toEqual([{ path: ["path", 233], message: "the line is a loop: its last point must repeat its first, [126.992374, 37.587807]" }]);
  });

  it.each([
    ["one below the bound", MAX_ROUTE_LINE_SEGMENT_M - 1, 0],
    ["at the bound", MAX_ROUTE_LINE_SEGMENT_M, 0],
    ["one above the bound", MAX_ROUTE_LINE_SEGMENT_M + 1, 1],
  ])("Segment length %s: a first segment of %i m gives %i issues", (_label, meters, issueCount) => {
    // Act
    const issues = toRouteLineIssues(loopWithFirstSegment(meters));

    // Assert
    expect(issues).toHaveLength(issueCount);
  });

  it("names a stray point's segment and its length", () => {
    // Arrange
    const line = hsscRouteLineFixture();
    line.path[10] = [127.01, 37.6];

    // Act
    const issues = toRouteLineIssues(line);

    // Assert
    expect(issues.map((issue) => issue.path)).toEqual([["path", 10], ["path", 11]]);
    expect(issues[0]!.message).toMatch(/^the segment from point 9 is \d+ m, over the 100 m a measured line has between points$/);
  });
});
