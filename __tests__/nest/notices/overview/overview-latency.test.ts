/**
 * Spec "Bounded response time": a valid overview request is answered within
 * 24 s even when the ai never responds. The retrieval cap plus the ai timeout
 * must fit the budget, and a hung ai must end as a null overview, not an error.
 */
import {
  AI_TIMEOUT_MS,
  type AiOverviewResult,
} from "../../../../src/notices/overview/overview.ai-client";
import { RETRIEVAL_MAX_TIME_MS } from "../../../../src/notices/overview/overview.retriever";
import { NoticesOverviewService } from "../../../../src/notices/overview/overview.service";
import { NoticesSearchService } from "../../../../src/notices/search.service";
import { SourcesService } from "../../../../src/notices/sources.service";
import { candidate } from "../../../helpers/overview-fixtures";

const BUDGET_MS = 24_000;

afterEach(() => jest.useRealTimers());

it("fits the retrieval cap and the ai timeout inside the 24 s budget", () => {
  expect(RETRIEVAL_MAX_TIME_MS + AI_TIMEOUT_MS).toBeLessThan(BUDGET_MS);
});

it("answers a hung ai with a null overview once the client times out", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-06T08:00:00Z") });
  const retriever = { retrieve: jest.fn().mockResolvedValue([candidate()]) };
  // The client's own timeout is what ends a hung call; model it as resolving
  // to a timeout failure exactly when that timer fires.
  const ai = {
    generate: jest.fn(
      () =>
        new Promise<AiOverviewResult>((resolve) =>
          setTimeout(
            () => resolve({ kind: "failed", httpStatus: null, code: "timeout" }),
            AI_TIMEOUT_MS,
          ),
        ),
    ),
  };
  const service = new NoticesOverviewService(
    new NoticesSearchService(),
    new SourcesService(),
    retriever as never,
    ai as never,
  );

  const started = Date.now();
  const pending = service.getOverview("장학금", "skku-main", "ko");
  await jest.advanceTimersByTimeAsync(AI_TIMEOUT_MS);
  const result = await pending;

  expect(result).toEqual({ overview: null, meta: { cached: false, reason: "unavailable" } });
  expect(Date.now() - started).toBeLessThanOrEqual(BUDGET_MS);
});
