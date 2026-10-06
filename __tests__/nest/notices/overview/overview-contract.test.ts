/**
 * The ai response parser: shape only, so a contract change degrades to
 * "unavailable" instead of reaching the app half-formed.
 */
import {
  parseAiOverviewResponse,
  toAiNotice,
} from "../../../../src/notices/overview/overview.contract";
import { aiResponse, candidate } from "../../../helpers/overview-fixtures";

describe("parseAiOverviewResponse", () => {
  it("accepts a contract-shaped answer", () => {
    const body = aiResponse({ sources: [{ n: 1, contentMissing: true }] });
    expect(parseAiOverviewResponse(body)).toEqual(body);
  });

  it("accepts no_answer with empty arrays", () => {
    const body = aiResponse({ status: "no_answer", lead: null, points: [], sources: [] });
    expect(parseAiOverviewResponse(body)).toEqual(body);
  });

  it("treats a missing contentMissing as false and drops unknown source fields", () => {
    const parsed = parseAiOverviewResponse({
      ...aiResponse(),
      sources: [{ n: 1, summaryStale: true }],
    });
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
    expect(parseAiOverviewResponse(body)).toBeNull();
  });
});

describe("toAiNotice", () => {
  it("sends DB field names and keeps link identity on the server", () => {
    const c = candidate({ contentText: "본문", summaryContentHash: "old" });
    const sent = toAiNotice(c) as unknown as Record<string, unknown>;

    expect(sent.title).toBe(c.title);
    expect(sent.contentText).toBe("본문");
    expect(sent.summaryContentHash).toBe("old");
    expect(sent.summaryLocations).toBeNull();
    expect(sent).not.toHaveProperty("_id");
    expect(sent).not.toHaveProperty("sourceId");
    expect(sent).not.toHaveProperty("articleNo");
  });
});
