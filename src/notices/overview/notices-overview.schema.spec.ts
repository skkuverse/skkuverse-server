/**
 * The ai response parser: shape only, so a contract change degrades to
 * "unavailable" instead of reaching the app half-formed.
 */
import { aiResponse } from "../../../__tests__/helpers/overview-fixtures";
import { parseAiOverviewResponse } from "./notices-overview.schema";

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
