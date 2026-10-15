/**
 * The ai response parser: shape only, so a contract change degrades to
 * "unavailable" instead of reaching the app half-formed. And the route's
 * query: sources first, then q, each refused as a 400 before any read.
 */
import { aiResponse } from "../../../__tests__/helpers/overview-fixtures";
import { overviewRequest, parseAiOverviewResponse } from "./notices-overview.schema";

describe("overviewRequest", () => {
  it("passes a captured query, trimming q", () => {
    // Act & Assert
    expect(overviewRequest.parse({ sourceIds: "skku-main,skku-notice02", q: " 장학금 " })).toEqual({ sourceIds: ["skku-main", "skku-notice02"], q: "장학금" });
  });

  it.each([
    ["missing q", { sourceIds: "skku-main" }],
    ["blank q", { sourceIds: "skku-main", q: "   " }],
    ["q over 100 codepoints", { sourceIds: "skku-main", q: "가".repeat(101) }],
    ["a repeated q", { sourceIds: "skku-main", q: ["a", "b"] }],
  ])("fails %s with the q message", (_label, query) => {
    // Act & Assert
    expect(overviewRequest.safeParse(query).error?.issues[0]?.message).toBe("q: 1-100 characters required");
  });

  it.each([
    ["missing sourceIds", { q: "장학금" }, "INVALID_PARAMS"],
    ["a repeated sourceIds", { q: "장학금", sourceIds: ["skku-main", "skku-main"] }, "INVALID_PARAMS"],
    ["21 sourceIds", { q: "장학금", sourceIds: Array(21).fill("skku-main").join(",") }, "INVALID_PARAMS"],
    ["an unknown source", { q: "장학금", sourceIds: "nope" }, "INVALID_SOURCE_ID"],
    ["an unknown source before a bad q", { q: "", sourceIds: "nope" }, "INVALID_SOURCE_ID"],
  ])("throws %s as a 400 with its code", (_label, query, code) => {
    // Act & Assert
    expect(() => overviewRequest.safeParse(query)).toThrow(expect.objectContaining({ code, httpStatus: 400 }));
  });
});

describe("parseAiOverviewResponse", () => {
  it("accepts a contract-shaped answer", () => {
    // Act
    const body = aiResponse({ sources: [{ n: 1, contentMissing: true }] });

    // Assert
    expect(parseAiOverviewResponse(body)).toEqual(body);
  });

  it("accepts no_answer with empty arrays", () => {
    // Act
    const body = aiResponse({ status: "no_answer", lead: null, points: [], sources: [] });

    // Assert
    expect(parseAiOverviewResponse(body)).toEqual(body);
  });

  it("treats a missing contentMissing as false and drops unknown source fields", () => {
    // Act
    const parsed = parseAiOverviewResponse({
      ...aiResponse(),
      sources: [{ n: 1, summaryStale: true }],
    });

    // Assert
    expect(parsed!.sources).toEqual([{ n: 1, contentMissing: false }]);
  });

  it.each([
    ["not an object", "oops"],
    ["unknown status", { ...aiResponse(), status: "maybe" }],
    ["unknown lang", { ...aiResponse(), lang: "zh" }],
    ["points not an array", { ...aiResponse(), points: null }],
    ["lead without cites", { ...aiResponse(), lead: { text: "x" } }],
    ["empty sentence text", { ...aiResponse(), points: [{ text: " ", cites: [1] }] }],
    ["non-numeric cite", { ...aiResponse(), points: [{ text: "x", cites: ["1"] }] }],
    ["source without n", { ...aiResponse(), sources: [{ contentMissing: false }] }],
    ["missing model", { ...aiResponse(), model: undefined }],
  ])("rejects %s", (_label, body) => {
    // Act & Assert
    expect(parseAiOverviewResponse(body)).toBeNull();
  });
});
