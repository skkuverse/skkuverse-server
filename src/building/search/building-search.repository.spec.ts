/**
 * The search aggregation BuildingSearchRepository sends, pinned as structure:
 * campus filters only inside the facet (the counts must span both campuses for
 * the app's campus toggle), the score is computed once before the facet, and
 * the strong and weak bands partition the match set under their own caps.
 * These say what the pipeline object looks like, not which documents match or
 * in what order; that query meaning is for a real-mongod spec
 * (harden-test-suite D6), so add no new pins here.
 */
const mockCollection = {
  aggregate: jest.fn(),
};

jest.mock("../../infra/db", () => ({
  getClient: jest.fn(() => ({
    db: () => ({ collection: () => mockCollection }),
  })),
}));

jest.mock("../../infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import type { Document } from "mongodb";
import { SPACE_SEARCH_LIMIT, SPACE_STRONG_MIN_SCORE, SPACE_WEAK_LIMIT } from "./building-search.rules";
import { BuildingSearchRepository } from "./building-search.repository";

describe("BuildingSearchRepository.searchSpaces pipeline assembly", () => {
  function capturePipeline(campus?: "hssc" | "nsc"): Promise<Document[]> {
    let captured: Document[] = [];
    mockCollection.aggregate.mockImplementation((pipeline: Document[]) => {
      captured = pipeline;
      return {
        toArray: jest
          .fn()
          .mockResolvedValue([
            { strong: [], weak: [], counts: [], total: [] },
          ]),
      };
    });
    return new BuildingSearchRepository().searchSpaces("27", campus).then(() => captured);
  }

  beforeEach(() => {
    mockCollection.aggregate.mockReset();
  });

  const facetOf = (pipeline: Document[]): Record<string, Document[]> =>
    (pipeline[2] as { $facet: Record<string, Document[]> }).$facet;

  it("keeps campus inside the facet, never in the leading $match", async () => {
    // Act
    const pipeline = await capturePipeline("nsc");
    const facet = facetOf(pipeline);

    // Assert
    expect(JSON.stringify(pipeline[0])).not.toContain("campus");
    expect(facet.strong?.[0]).toEqual({ $match: { campus: "nsc" } });
    expect(facet.weak?.[0]).toEqual({ $match: { campus: "nsc" } });
    expect(facet.total?.[0]).toEqual({ $match: { campus: "nsc" } });
    // counts must span both campuses.
    expect(JSON.stringify(facet.counts)).not.toContain("nsc");
  });

  it("omits the campus stage entirely when no campus is given", async () => {
    // Act
    const pipeline = await capturePipeline();
    const facet = facetOf(pipeline);

    // Assert
    expect(facet.strong?.[0]).toEqual({
      $match: { _score: { $gte: SPACE_STRONG_MIN_SCORE } },
    });
    expect(facet.total?.[0]).toEqual({ $count: "n" });
  });

  it("scores once before the facet, not per band", async () => {
    // Act
    const pipeline = await capturePipeline();
    const facet = facetOf(pipeline);

    // Assert
    expect(pipeline[1]).toHaveProperty("$addFields._score");
    for (const band of [facet.strong, facet.weak]) {
      expect(JSON.stringify(band)).not.toContain("$addFields");
    }
  });

  it("splits the caps by band so a weak query cannot flood the client", async () => {
    // Act
    const pipeline = await capturePipeline();
    const facet = facetOf(pipeline);

    // Assert
    expect(facet.strong).toContainEqual({ $limit: SPACE_SEARCH_LIMIT });
    expect(facet.weak).toContainEqual({ $limit: SPACE_WEAK_LIMIT });
    // Bands must partition the match set — no row counted twice, none dropped.
    expect(facet.strong).toContainEqual({
      $match: { _score: { $gte: SPACE_STRONG_MIN_SCORE } },
    });
    expect(facet.weak).toContainEqual({
      $match: { _score: { $lt: SPACE_STRONG_MIN_SCORE } },
    });
    for (const band of [facet.strong, facet.weak]) {
      expect(band).toContainEqual({ $sort: { _score: -1, spaceCd: 1, buildNo: 1, campus: 1 } });
      expect(band).toContainEqual({
        $project: { _id: 0, _score: 0, sources: 0, syncedAt: 0 },
      });
    }
  });
});
