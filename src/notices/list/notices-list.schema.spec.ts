/**
 * The list routes' one input schema: fields are checked in the order the route always answered them (the
 * source, then the type, then the cursor), the limit is parseInt clamped to 1..50 with 20 by default, an empty
 * type or cursor means none, and the search text is trimmed or dropped, never an error.
 */
import { AppError } from "../../http/app.error";
import { encodeCursor } from "./notices-list.mapper";
import { multiListRequest, sourceListRequest } from "./notices-list.schema";

const firstIssue = (result: { error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }): unknown => {
  const issue = result.error?.issues[0];
  return issue ? [issue.path.join("."), issue.message] : undefined;
};

describe("sourceListRequest", () => {
  it("defaults the limit to 20 and leaves the type, cursor and search out", () => {
    // Act & Assert
    expect(sourceListRequest.parse({ sourceId: "skku-notice02" })).toMatchObject({ sourceId: "skku-notice02", limit: 20, cursor: null });
  });

  it.each([
    ["0", 1],
    ["1", 1],
    ["50", 50],
    ["51", 50],
    ["12abc", 12],
    ["abc", 20],
  ])("reads limit %j as %j", (raw, limit) => {
    // Act & Assert
    expect(sourceListRequest.parse({ sourceId: "skku-notice02", limit: raw }).limit).toBe(limit);
  });

  it("decodes a cursor and trims the search text", () => {
    // Arrange
    const cursor = { d: "2026-04-01", i: "66a1b2c3d4e5f6a7b8c9d0e1" };

    // Act
    const parsed = sourceListRequest.parse({ sourceId: "skku-notice02", cursor: encodeCursor(cursor), q: "  장학  ", type: "event" });

    // Assert
    expect(parsed).toMatchObject({ cursor, q: "장학", type: "event" });
  });

  it("reports the source first, then the type, then the cursor", () => {
    // Act & Assert
    expect(firstIssue(sourceListRequest.safeParse({ sourceId: "nope", type: "bogus", cursor: "!!!" }))).toEqual(["sourceId", "unknown sourceId: nope"]);
    expect(firstIssue(sourceListRequest.safeParse({ sourceId: "skku-notice02", type: "bogus", cursor: "!!!" }))).toEqual([
      "type",
      "type must be one of: action_required, event, informational",
    ]);
    expect(firstIssue(sourceListRequest.safeParse({ sourceId: "skku-notice02", cursor: "!!!" }))).toEqual(["cursor", "cursor is malformed"]);
  });

  it("treats an empty type and an empty cursor as none, and drops an over-long search", () => {
    // Act
    const parsed = sourceListRequest.parse({ sourceId: "skku-notice02", type: "", cursor: "", q: "x".repeat(101) });

    // Assert
    expect(parsed).toMatchObject({ type: undefined, cursor: null, q: undefined });
  });
});

describe("multiListRequest", () => {
  it("splits the source ids", () => {
    // Act & Assert
    expect(multiListRequest.parse({ sourceIds: "skku-notice02, skku-notice06" }).sourceIds).toEqual(["skku-notice02", "skku-notice06"]);
  });

  it("refuses missing or unknown ids with the route's errors, before the other fields", () => {
    // Act & Assert
    expect(() => multiListRequest.parse({ type: "bogus" })).toThrow(new AppError("INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required", 400));
    expect(() => multiListRequest.parse({ sourceIds: "skku-notice02,nope", type: "bogus" })).toThrow(
      new AppError("INVALID_SOURCE_ID", "unknown sourceId: nope", 400),
    );
  });

  it("refuses a repeated sourceIds as missing ids, the route's 400", () => {
    // Act & Assert
    expect(() => multiListRequest.parse({ sourceIds: ["skku-notice02", "skku-notice06"] })).toThrow(
      new AppError("INVALID_PARAMS", "sourceIds: 1-20 comma-separated source IDs required", 400),
    );
  });
});
