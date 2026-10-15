/**
 * The retrieval read: it runs the pinned pipeline (notices-overview.query.spec.ts) with the service start date
 * and the server-side time cap, and a database error rejects, so the service degrades to "unavailable".
 */
const toArray = jest.fn();
const aggregate = jest.fn((..._args: unknown[]) => ({ toArray }));

jest.mock("../../infra/db", () => ({
  getClient: () => ({ db: () => ({ collection: () => ({ aggregate }) }) }),
}));

import { RETRIEVAL_MAX_TIME_MS } from "./notices-overview.constants";
import { toOverviewPipeline } from "./notices-overview.query";
import { NoticesOverviewRepository } from "./notices-overview.repository";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesOverviewRepository.searchCandidates", () => {
  it("runs the pipeline with the service start date and the time cap", async () => {
    // Arrange
    const docs = [{ title: "a" }];
    toArray.mockResolvedValueOnce(docs);

    // Act
    const result = await new NoticesOverviewRepository().searchCandidates("장학금", ["skku-main"]);

    // Assert
    expect(result).toBe(docs);
    expect(aggregate).toHaveBeenCalledWith(
      toOverviewPipeline({ q: "장학금", sourceIds: ["skku-main"], serviceStartDate: "2026-03-09" }),
      { maxTimeMS: RETRIEVAL_MAX_TIME_MS },
    );
    expect(RETRIEVAL_MAX_TIME_MS).toBe(1_500);
  });

  it("propagates a database error", async () => {
    // Arrange
    toArray.mockRejectedValueOnce(new Error("maxTimeMS expired"));

    // Act & Assert
    await expect(new NoticesOverviewRepository().searchCandidates("q", ["skku-main"])).rejects.toThrow("maxTimeMS expired");
  });
});
