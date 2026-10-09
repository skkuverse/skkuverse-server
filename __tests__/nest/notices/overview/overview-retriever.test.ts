/**
 * The retrieval aggregate (spec: "Candidate scope", "Candidate selection").
 * Pins the exact pipeline: scope filters live inside both sub-pipelines, the
 * vector stage names no model, and the server-side time cap is set.
 */
jest.mock("../../../../src/notices/notices.data", () => ({
  getNoticesCollection: jest.fn(),
}));

import { getNoticesCollection } from "../../../../src/notices/notices.data";
import {
  OverviewRetriever,
  RETRIEVAL_LIMIT,
  RETRIEVAL_MAX_TIME_MS,
  buildOverviewPipeline,
} from "../../../../src/notices/overview/overview.retriever";

const getCollection = getNoticesCollection as jest.Mock;

describe("buildOverviewPipeline", () => {
  const pipeline = buildOverviewPipeline({
    q: "기숙사",
    sourceIds: ["skku-main", "cs"],
    serviceStartDate: "2026-03-09",
  });
  const fusion = pipeline[0]!.$rankFusion.input.pipelines;

  it("scopes the lexical side to the sources, not-deleted and the start date", () => {
    const [search, match, limit] = fusion.text;
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
    const [vector, match] = fusion.vector;
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
    expect(pipeline[1]).toEqual({ $limit: 20 });
    expect(Object.keys(pipeline[2]!.$project).sort()).toEqual(
      [
        "_id", "sourceId", "articleNo", "title", "date", "department", "category",
        "summary", "summaryOneLiner", "summaryType", "summaryPeriods",
        "summaryLocations", "summaryDetails", "contentText", "contentHash",
        "summaryContentHash", "summaryApplication",
      ].sort(),
    );
  });
});

describe("OverviewRetriever", () => {
  it("runs the pipeline with the service start date and the time cap", async () => {
    const docs = [{ title: "a" }];
    const aggregate = jest.fn(() => ({ toArray: async () => docs }));
    getCollection.mockReturnValue({ aggregate });

    const result = await new OverviewRetriever().retrieve("장학금", ["skku-main"]);

    expect(result).toBe(docs);
    expect(aggregate).toHaveBeenCalledWith(
      buildOverviewPipeline({ q: "장학금", sourceIds: ["skku-main"], serviceStartDate: "2026-03-09" }),
      { maxTimeMS: RETRIEVAL_MAX_TIME_MS },
    );
    expect(RETRIEVAL_MAX_TIME_MS).toBe(1_500);
  });

  it("propagates a database error", async () => {
    getCollection.mockReturnValue({
      aggregate: () => ({ toArray: async () => Promise.reject(new Error("maxTimeMS expired")) }),
    });

    await expect(new OverviewRetriever().retrieve("q", ["skku-main"])).rejects.toThrow(
      "maxTimeMS expired",
    );
  });
});
