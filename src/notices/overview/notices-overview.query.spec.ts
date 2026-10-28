/**
 * A structure pin (tests.md): the retrieval aggregate. Scope
 * filters live inside both sub-pipelines, the vector stage names no model, and the fused result is capped and
 * projected to the candidate fields.
 */
import { RETRIEVAL_LIMIT } from "./notices-overview.constants";
import { toOverviewPipeline } from "./notices-overview.query";

describe("toOverviewPipeline", () => {
  const pipeline = toOverviewPipeline({
    q: "기숙사",
    sourceIds: ["skku-main", "cs"],
    serviceStartDate: "2026-03-09",
  });
  const fusion = pipeline[0]!.$rankFusion.input.pipelines;

  it("scopes the lexical side to the sources, not-deleted and the start date", () => {
    // Act
    const [search, match, limit] = fusion.text;

    // Assert
    expect(search.$search.index).toBe("notices_search");
    expect(search.$search.compound.must).toEqual([
      { text: { query: "기숙사", path: ["title", "summaryOneLiner", "summary", "contentText"] } },
    ]);
    expect(search.$search.compound.filter).toEqual([
      { in: { path: "sourceId", value: ["skku-main", "cs"] } },
    ]);
    expect(search.$search.compound.mustNot).toEqual([
      { equals: { path: "isDeleted", value: true } },
    ]);
    expect(match).toEqual({ $match: { date: { $gte: "2026-03-09" } } });
    expect(limit).toEqual({ $limit: RETRIEVAL_LIMIT });
  });

  it("scopes the vector side the same way and names no embedding model", () => {
    // Act
    const [vector, match] = fusion.vector;

    // Assert
    expect(vector.$vectorSearch).toEqual({
      index: "notices_vector",
      path: "embeddingInput",
      query: { text: "기숙사" },
      filter: { sourceId: { $in: ["skku-main", "cs"] }, isDeleted: { $ne: true } },
      exact: true,
      limit: RETRIEVAL_LIMIT,
    });
    expect(vector.$vectorSearch).not.toHaveProperty("model");
    expect(match).toEqual({ $match: { date: { $gte: "2026-03-09" } } });
  });

  it("caps the fused result and projects the candidate fields", () => {
    // Assert
    expect(pipeline[1]).toEqual({ $limit: 20 });
    expect(Object.keys(pipeline[2]!.$project).sort()).toEqual(
      [
        "_id", "sourceId", "articleNo", "title", "date", "department", "category",
        "summary", "summaryOneLiner", "summaryType", "summaryPeriods",
        "summaryLocations", "summaryDetails", "contentText", "contentHash",
        "summaryContentHash", "summaryApplication", "dupOf",
      ].sort(),
    );
  });
});
