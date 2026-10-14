/**
 * Citation mapping (spec: "Citation mapping"): ai positions become app numbers
 * 1..M in first-cited order, and every cite resolves to exactly one source.
 * The ai input keeps DB field names and leaves the link identity on the server.
 */
import { aiResponse, candidate } from "../../../__tests__/helpers/overview-fixtures";
import { mapOverview, toAiNotice } from "./notices-overview.mapper";

const AT = new Date("2026-10-06T08:00:02.512Z");

function mapped(result: ReturnType<typeof mapOverview>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.overview;
}

describe("mapOverview", () => {
  it("renumbers sources by first citation (spec scenario)", () => {
    // Arrange
    const [a, b, c] = [candidate(), candidate(), candidate()];
    const ai = aiResponse({
      lead: { text: "lead", cites: [3] },
      points: [{ text: "point", cites: [1, 3] }],
      sources: [
        { n: 3, contentMissing: false },
        { n: 1, contentMissing: false },
      ],
    });

    // Act
    const overview = mapped(mapOverview([a!, b!, c!], ai, AT));

    // Assert
    expect(overview.lead).toEqual({ text: "lead", cites: [1] });
    expect(overview.points).toEqual([{ text: "point", cites: [2, 1] }]);
    expect(overview.sources).toEqual([
      { n: 1, sourceId: c!.sourceId, articleNo: c!.articleNo, title: c!.title, date: c!.date, contentMissing: false },
      { n: 2, sourceId: a!.sourceId, articleNo: a!.articleNo, title: a!.title, date: a!.date, contentMissing: false },
    ]);
    expect(overview.generatedAt).toBe("2026-10-06T08:00:02.512Z");
    expect(overview.lang).toBe("ko");
  });

  it("keeps a partial answer with no lead", () => {
    // Arrange
    const ai = aiResponse({
      status: "partial",
      lead: null,
      points: [
        { text: "one", cites: [1] },
        { text: "two", cites: [2] },
        { text: "three", cites: [1] },
      ],
    });

    // Act
    const overview = mapped(mapOverview([candidate(), candidate()], ai, AT));

    // Assert
    expect(overview.lead).toBeNull();
    expect(overview.points).toHaveLength(3);
    expect(overview.sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it("drops cite numbers outside 1..K and sentences left with none", () => {
    // Arrange
    const ai = aiResponse({
      lead: { text: "lead", cites: [0, 4, 1.5] },
      points: [
        { text: "kept", cites: [2, 9] },
        { text: "dropped", cites: [7] },
      ],
    });

    // Act
    const overview = mapped(mapOverview([candidate(), candidate(), candidate()], ai, AT));

    // Assert
    expect(overview.lead).toBeNull();
    expect(overview.points).toEqual([{ text: "kept", cites: [1] }]);
    expect(overview.sources).toHaveLength(1);
  });

  it("reports a contract violation when no sentence has a valid cite", () => {
    // Act
    const ai = aiResponse({
      lead: { text: "lead", cites: [5] },
      points: [{ text: "point", cites: [] }],
    });

    // Assert
    expect(mapOverview([candidate()], ai, AT)).toEqual({
      ok: false,
      reason: "no_cited_sentences",
    });
  });

  it("passes contentMissing through for an image-only notice", () => {
    // Arrange
    const ai = aiResponse({
      lead: { text: "lead", cites: [2] },
      points: [],
      sources: [{ n: 2, contentMissing: true }],
    });

    // Act
    const overview = mapped(mapOverview([candidate(), candidate()], ai, AT));

    // Assert
    expect(overview.sources).toEqual([
      expect.objectContaining({ n: 1, contentMissing: true }),
    ]);
  });

  it("shows at most 5 points and numbers no source that only a hidden point cites", () => {
    // Arrange
    const cands = Array.from({ length: 6 }, () => candidate());
    const ai = aiResponse({
      lead: null,
      points: [1, 1, 1, 1, 1, 6].map((n) => ({ text: `p${n}`, cites: [n] })),
    });

    // Act
    const overview = mapped(mapOverview(cands, ai, AT));

    // Assert
    expect(overview.points).toHaveLength(5);
    expect(overview.sources).toHaveLength(1);
  });

  it("collapses a repeated cite within one sentence", () => {
    // Arrange
    const ai = aiResponse({ lead: { text: "lead", cites: [1, 1] }, points: [] });

    // Act
    const overview = mapped(mapOverview([candidate()], ai, AT));

    // Assert
    expect(overview.lead!.cites).toEqual([1]);
  });
});

describe("toAiNotice", () => {
  it("sends DB field names and keeps link identity on the server", () => {
    // Arrange
    const c = candidate({ contentText: "본문", summaryContentHash: "old" });

    // Act
    const sent = toAiNotice(c) as unknown as Record<string, unknown>;

    // Assert
    expect(sent.title).toBe(c.title);
    expect(sent.contentText).toBe("본문");
    expect(sent.summaryContentHash).toBe("old");
    expect(sent.summaryLocations).toBeNull();
    expect(sent).not.toHaveProperty("_id");
    expect(sent).not.toHaveProperty("sourceId");
    expect(sent).not.toHaveProperty("articleNo");
  });

  it("passes summaryApplication through, null when the notice has none", () => {
    // Arrange
    const application = {
      status: "dated",
      windows: [{ startAt: null, endAt: "2026-10-14T00:00:00+09:00", openEnded: false }],
    };

    // Act
    const v2 = toAiNotice(candidate({ summaryApplication: application }));

    // Assert
    expect(v2.summaryApplication).toEqual(application);
    expect(toAiNotice(candidate()).summaryApplication).toBeNull();
  });
});
