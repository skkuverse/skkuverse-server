/**
 * NoticesOverviewService against stub retrieval and ai client. One block per
 * behavior: no candidates, degradation, budget pause, no answer, the
 * cache, the bounded response time, and NOTICE_OVERVIEW=off. Validation is overviewRequest's
 * (notices-overview.schema.spec.ts); the time is the injected clock's.
 */
import { aiResponse, candidate } from "../../../__tests__/helpers/overview-fixtures";
import type { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { AI_TIMEOUT_MS, MAX_BUDGET_PAUSE_MS, RETRIEVAL_MAX_TIME_MS } from "./notices-overview.constants";
import { NoticesOverviewService } from "./notices-overview.service";
import type { AiOverviewResult } from "./notices-overview.types";

const NOW = new Date("2026-10-06T08:00:00.000Z");

function setup() {
  const retriever = { retrieve: jest.fn() };
  const ai = { generate: jest.fn() };
  // The repository and client stubs keep this file's names: retriever.retrieve is searchCandidates, ai.generate postOverview.
  // The time each call reads; a test moves it with `clock.at`.
  const clock = { at: NOW, now(): Date { return this.at; } } satisfies Clock & { at: Date };
  const service = new NoticesOverviewService(
    { searchCandidates: retriever.retrieve } as never,
    { postOverview: ai.generate } as never,
    clock,
  );
  return { service, retriever, ai, clock };
}

function ok(extra = {}): AiOverviewResult {
  return { kind: "ok", response: aiResponse(extra) };
}

describe("NoticesOverviewService.getOverview answers", () => {
  it("sends the top 6 distinct candidates with the request time and language", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    const dup = candidate({ title: "same", contentHash: "h" });
    const ranked = [dup, { ...dup, sourceId: "skku-notice02" }, ...Array.from({ length: 8 }, () => candidate())];
    retriever.retrieve.mockResolvedValue(ranked);
    ai.generate.mockResolvedValue(ok());

    // Act
    const result = await service.getOverview({ q: "장학금", sourceIds: ["skku-main", "skku-notice02"], lang: "en" });

    // Assert
    expect(retriever.retrieve).toHaveBeenCalledWith("장학금", ["skku-main", "skku-notice02"]);
    const sent = ai.generate.mock.calls[0]![0];
    expect(sent.query).toBe("장학금");
    expect(sent.now).toBe("2026-10-06T08:00:00.000Z");
    expect(sent.lang).toBe("en");
    expect(sent.notices).toHaveLength(6);
    expect(sent.notices[0].title).toBe("same");
    expect(sent.notices[1].title).not.toBe("same");
    expect(result.meta).toEqual({ cached: false });
    expect(result.overview!.sources[0]).toEqual(
      expect.objectContaining({ n: 1, sourceId: dup.sourceId, articleNo: dup.articleNo }),
    );
  });

  it("returns no_results without calling the ai", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([]);

    // Act
    const result = await service.getOverview({ q: "없는말", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "no_results" } });
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("maps no_answer to a null overview", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok({ status: "no_answer", lead: null, points: [], sources: [] }));

    // Act
    const result = await service.getOverview({ q: "날씨", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "no_answer" } });
  });
});

describe("graceful degradation", () => {
  it.each<[string, AiOverviewResult]>([
    ["a 502", { kind: "failed", httpStatus: 502, code: "invalid_output" }],
    ["a timeout", { kind: "failed", httpStatus: null, code: "timeout" }],
    ["a malformed 200", { kind: "malformed" }],
    ["an answer with no valid cite", ok({ lead: { text: "x", cites: [9] }, points: [] })],
  ])("returns unavailable for %s", async (_label, outcome) => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(outcome);

    // Act
    const result = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "unavailable" } });
  });

  it("returns unavailable when retrieval fails, without calling the ai", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockRejectedValue(new Error("maxTimeMS expired"));

    // Act
    const result = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(result.meta.reason).toBe("unavailable");
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("returns unavailable when the ai client throws unexpectedly", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockRejectedValue(new TypeError("bug"));

    // Act
    const result = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(result.meta.reason).toBe("unavailable");
  });
});

describe("budget pause", () => {
  const RETRY_AT = new Date("2026-10-07T00:00:00Z");

  it("stops calling the ai until retryAt, then resumes", async () => {
    // Arrange
    const { service, retriever, ai, clock } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: RETRY_AT });

    clock.at = new Date("2026-10-06T15:00:00Z");
    const first = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    clock.at = new Date("2026-10-06T23:59:00Z");
    const paused = await service.getOverview({ q: "기숙사", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(first.meta.reason).toBe("unavailable");
    expect(paused.meta.reason).toBe("unavailable");
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);

    ai.generate.mockResolvedValueOnce(ok());
    clock.at = new Date("2026-10-07T00:00:01Z");
    const resumed = await service.getOverview({ q: "기숙사", sourceIds: ["skku-main"], lang: "ko" });
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(resumed.overview).not.toBeNull();
  });

  it("caps a far-future retryAt at 24 hours", async () => {
    // Arrange
    const { service, retriever, ai, clock } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: new Date("2027-01-01T00:00:00Z") });
    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    ai.generate.mockResolvedValueOnce(ok());
    const after = new Date(NOW.getTime() + MAX_BUDGET_PAUSE_MS + 1);

    // Act
    clock.at = after;
    await service.getOverview({ q: "기숙사", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("does not pause when retryAt is missing", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: null });
    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    ai.generate.mockResolvedValueOnce(ok());

    // Act
    await service.getOverview({ q: "기숙사", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });
});

describe("overview cache", () => {
  it("reuses an overview for a respaced query and marks it cached", async () => {
    // Arrange
    const { service, retriever, ai, clock } = setup();
    const docs = [candidate()];
    retriever.retrieve.mockResolvedValue(docs);
    ai.generate.mockResolvedValue(ok());

    const first = await service.getOverview({ q: "장학금  신청", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    clock.at = new Date(NOW.getTime() + 5 * 60_000);
    const second = await service.getOverview({ q: "장학금 신청", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.overview).toEqual(first.overview);
  });

  it("caches no_answer too", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok({ status: "no_answer", lead: null, points: [], sources: [] }));

    await service.getOverview({ q: "날씨", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    const again = await service.getOverview({ q: "날씨", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(again.meta).toEqual({ cached: true, reason: "no_answer" });
  });

  it("calls the ai again when a candidate's content changed", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    const doc = candidate();
    retriever.retrieve.mockResolvedValueOnce([doc]).mockResolvedValueOnce([{ ...doc, contentHash: "edited" }]);
    ai.generate.mockResolvedValue(ok());

    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("calls the ai again on the next KST day", async () => {
    // Arrange
    const { service, retriever, ai, clock } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok());

    clock.at = new Date("2026-10-06T14:50:00Z");
    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    clock.at = new Date("2026-10-06T15:10:00Z");
    await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate
      .mockResolvedValueOnce({ kind: "failed", httpStatus: 502, code: "llm_error" })
      .mockResolvedValueOnce(ok());

    const first = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Act
    const second = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

    // Assert
    expect(first.meta.reason).toBe("unavailable");
    expect(second.overview).not.toBeNull();
    expect(second.meta.cached).toBe(false);
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("shares one ai call between concurrent identical requests", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    let release!: (v: AiOverviewResult) => void;
    ai.generate.mockReturnValue(new Promise<AiOverviewResult>((r) => (release = r)));

    const a = service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });
    const b = service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });
    await new Promise((r) => setImmediate(r));
    release(ok());

    // Act
    const [ra, rb] = await Promise.all([a, b]);

    // Assert
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect([ra.meta.cached, rb.meta.cached].sort()).toEqual([false, true]);
    expect(ra.overview).toEqual(rb.overview);
  });
});

const BUDGET_MS = 24_000;

describe("bounded response time (answered within 24 s even when the ai never responds)", () => {
  afterEach(() => jest.useRealTimers());

  it("fits the retrieval cap and the ai timeout inside the 24 s budget", () => {
    // Assert
    expect(RETRIEVAL_MAX_TIME_MS + AI_TIMEOUT_MS).toBeLessThan(BUDGET_MS);
  });

  it("answers a hung ai with a null overview once the client times out", async () => {
    // Arrange
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
    const clock: Clock = { now: () => new Date() };
    const service = new NoticesOverviewService(
      { searchCandidates: retriever.retrieve } as never,
      { postOverview: ai.generate } as never,
      clock,
    );

    const started = Date.now();
    const pending = service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });
    await jest.advanceTimersByTimeAsync(AI_TIMEOUT_MS);

    // Act
    const result = await pending;

    // Assert
    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "unavailable" } });
    expect(Date.now() - started).toBeLessThanOrEqual(BUDGET_MS);
  });
});

describe("with NOTICE_OVERVIEW off", () => {
  const overviewConfig = config.notices.overview as { enabled: boolean };

  it("answers unavailable without retrieving or calling the ai", async () => {
    // Arrange
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok());
    const enabled = overviewConfig.enabled;
    overviewConfig.enabled = false;

    try {
      // Act
      const result = await service.getOverview({ q: "장학금", sourceIds: ["skku-main"], lang: "ko" });

      // Assert
      expect(result).toEqual({ overview: null, meta: { cached: false, reason: "unavailable" } });
      // Each overview the switch lets through is one paid ai call; retrieval runs a query-time embedding.
      expect(ai.generate).not.toHaveBeenCalled();
      expect(retriever.retrieve).not.toHaveBeenCalled();
    } finally {
      overviewConfig.enabled = enabled;
    }
  });
});
