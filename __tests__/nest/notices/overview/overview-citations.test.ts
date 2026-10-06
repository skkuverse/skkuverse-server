/**
 * Citation mapping (spec: "Citation mapping"): ai positions become app numbers
 * 1..M in first-cited order, and every cite resolves to exactly one source.
 */
import { mapOverview } from "../../../../src/notices/overview/overview.citations";
import { aiResponse, candidate } from "../../../helpers/overview-fixtures";

const AT = new Date("2026-10-06T08:00:02.512Z");

function mapped(result: ReturnType<typeof mapOverview>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.overview;
}

describe("mapOverview", () => {
  it("renumbers sources by first citation (spec scenario)", () => {
    const [a, b, c] = [candidate(), candidate(), candidate()];
    const ai = aiResponse({
      lead: { text: "lead", cites: [3] },
      points: [{ text: "point", cites: [1, 3] }],
      sources: [
        { n: 3, contentMissing: false },
        { n: 1, contentMissing: false },
      ],
    });

    const overview = mapped(mapOverview([a!, b!, c!], ai, AT));

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
    const ai = aiResponse({
      status: "partial",
      lead: null,
      points: [
        { text: "one", cites: [1] },
        { text: "two", cites: [2] },
        { text: "three", cites: [1] },
      ],
    });

    const overview = mapped(mapOverview([candidate(), candidate()], ai, AT));

    expect(overview.lead).toBeNull();
    expect(overview.points).toHaveLength(3);
    expect(overview.sources.map((s) => s.n)).toEqual([1, 2]);
  });

  it("drops cite numbers outside 1..K and sentences left with none", () => {
    const ai = aiResponse({
      lead: { text: "lead", cites: [0, 4, 1.5] },
      points: [
        { text: "kept", cites: [2, 9] },
        { text: "dropped", cites: [7] },
      ],
    });

    const overview = mapped(mapOverview([candidate(), candidate(), candidate()], ai, AT));

    expect(overview.lead).toBeNull();
    expect(overview.points).toEqual([{ text: "kept", cites: [1] }]);
    expect(overview.sources).toHaveLength(1);
  });

  it("reports a contract violation when no sentence has a valid cite", () => {
    const ai = aiResponse({
      lead: { text: "lead", cites: [5] },
      points: [{ text: "point", cites: [] }],
    });

    expect(mapOverview([candidate()], ai, AT)).toEqual({
      ok: false,
      reason: "no_cited_sentences",
    });
  });

  it("passes contentMissing through for an image-only notice", () => {
    const ai = aiResponse({
      lead: { text: "lead", cites: [2] },
      points: [],
      sources: [{ n: 2, contentMissing: true }],
    });

    const overview = mapped(mapOverview([candidate(), candidate()], ai, AT));

    expect(overview.sources).toEqual([
      expect.objectContaining({ n: 1, contentMissing: true }),
    ]);
  });

  it("shows at most 5 points and numbers no source that only a hidden point cites", () => {
    const cands = Array.from({ length: 6 }, () => candidate());
    const ai = aiResponse({
      lead: null,
      points: [1, 1, 1, 1, 1, 6].map((n) => ({ text: `p${n}`, cites: [n] })),
    });

    const overview = mapped(mapOverview(cands, ai, AT));

    expect(overview.points).toHaveLength(5);
    expect(overview.sources).toHaveLength(1);
  });

  it("collapses a repeated cite within one sentence", () => {
    const ai = aiResponse({ lead: { text: "lead", cites: [1, 1] }, points: [] });

    const overview = mapped(mapOverview([candidate()], ai, AT));

    expect(overview.lead!.cites).toEqual([1]);
  });
});
