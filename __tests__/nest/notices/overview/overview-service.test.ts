/**
 * NoticesOverviewService against stub retrieval and ai client. One block per
 * spec requirement: validation, no candidates, degradation, budget pause,
 * no answer, and the cache.
 */
import { AppError } from "../../../../src/http/app.error";
import type { AiOverviewResult } from "../../../../src/notices/overview/overview.ai-client";
import {
  MAX_BUDGET_PAUSE_MS,
  NoticesOverviewService,
} from "../../../../src/notices/overview/overview.service";
import { NoticesSearchService } from "../../../../src/notices/search.service";
import { SourcesService } from "../../../../src/notices/sources.service";
import { aiResponse, candidate } from "../../../helpers/overview-fixtures";

const NOW = new Date("2026-10-06T08:00:00.000Z");

function setup() {
  const retriever = { retrieve: jest.fn() };
  const ai = { generate: jest.fn() };
  const service = new NoticesOverviewService(
    new NoticesSearchService(),
    new SourcesService(),
    retriever as never,
    ai as never,
  );
  return { service, retriever, ai };
}

function ok(extra = {}): AiOverviewResult {
  return { kind: "ok", response: aiResponse(extra) };
}

async function rejection(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    return err as AppError;
  }
  throw new Error("expected a rejection");
}

describe("request validation", () => {
  it.each([
    ["missing q", undefined, "skku-main", "INVALID_PARAMS"],
    ["blank q", "   ", "skku-main", "INVALID_PARAMS"],
    ["q over 100 codepoints", "가".repeat(101), "skku-main", "INVALID_PARAMS"],
    ["missing sourceIds", "장학금", undefined, "INVALID_PARAMS"],
    ["array sourceIds", "장학금", ["skku-main"], "INVALID_PARAMS"],
    ["21 sourceIds", "장학금", Array(21).fill("skku-main").join(","), "INVALID_PARAMS"],
    ["unknown source", "장학금", "nope", "INVALID_SOURCE_ID"],
  ])("rejects %s with 400 and touches nothing", async (_label, q, sourceIds, code) => {
    const { service, retriever, ai } = setup();

    const err = await rejection(service.getOverview(q, sourceIds, "ko", NOW));

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(code);
    expect(err.httpStatus).toBe(400);
    expect(retriever.retrieve).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });
});

describe("answers", () => {
  it("sends the top 6 distinct candidates with the request time and language", async () => {
    const { service, retriever, ai } = setup();
    const dup = candidate({ title: "same", contentHash: "h" });
    const ranked = [dup, { ...dup, sourceId: "skku-notice02" }, ...Array.from({ length: 8 }, () => candidate())];
    retriever.retrieve.mockResolvedValue(ranked);
    ai.generate.mockResolvedValue(ok());

    const result = await service.getOverview("장학금", "skku-main,skku-notice02", "en", NOW);

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
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([]);

    const result = await service.getOverview("없는말", "skku-main", "ko", NOW);

    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "no_results" } });
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("maps no_answer to a null overview", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok({ status: "no_answer", lead: null, points: [], sources: [] }));

    const result = await service.getOverview("날씨", "skku-main", "ko", NOW);

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
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(outcome);

    const result = await service.getOverview("장학금", "skku-main", "ko", NOW);

    expect(result).toEqual({ overview: null, meta: { cached: false, reason: "unavailable" } });
  });

  it("returns unavailable when retrieval fails, without calling the ai", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockRejectedValue(new Error("maxTimeMS expired"));

    const result = await service.getOverview("장학금", "skku-main", "ko", NOW);

    expect(result.meta.reason).toBe("unavailable");
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("returns unavailable when the ai client throws unexpectedly", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockRejectedValue(new TypeError("bug"));

    const result = await service.getOverview("장학금", "skku-main", "ko", NOW);

    expect(result.meta.reason).toBe("unavailable");
  });
});

describe("budget pause", () => {
  const RETRY_AT = new Date("2026-10-07T00:00:00Z");

  it("stops calling the ai until retryAt, then resumes", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: RETRY_AT });

    const first = await service.getOverview("장학금", "skku-main", "ko", new Date("2026-10-06T15:00:00Z"));
    const paused = await service.getOverview("기숙사", "skku-main", "ko", new Date("2026-10-06T23:59:00Z"));

    expect(first.meta.reason).toBe("unavailable");
    expect(paused.meta.reason).toBe("unavailable");
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(retriever.retrieve).toHaveBeenCalledTimes(1);

    ai.generate.mockResolvedValueOnce(ok());
    const resumed = await service.getOverview("기숙사", "skku-main", "ko", new Date("2026-10-07T00:00:01Z"));
    expect(ai.generate).toHaveBeenCalledTimes(2);
    expect(resumed.overview).not.toBeNull();
  });

  it("caps a far-future retryAt at 24 hours", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: new Date("2027-01-01T00:00:00Z") });
    await service.getOverview("장학금", "skku-main", "ko", NOW);

    ai.generate.mockResolvedValueOnce(ok());
    const after = new Date(NOW.getTime() + MAX_BUDGET_PAUSE_MS + 1);
    await service.getOverview("기숙사", "skku-main", "ko", after);

    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("does not pause when retryAt is missing", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValueOnce({ kind: "budget_exhausted", retryAt: null });
    await service.getOverview("장학금", "skku-main", "ko", NOW);

    ai.generate.mockResolvedValueOnce(ok());
    await service.getOverview("기숙사", "skku-main", "ko", NOW);

    expect(ai.generate).toHaveBeenCalledTimes(2);
  });
});

describe("overview cache", () => {
  it("reuses an overview for a respaced query and marks it cached", async () => {
    const { service, retriever, ai } = setup();
    const docs = [candidate()];
    retriever.retrieve.mockResolvedValue(docs);
    ai.generate.mockResolvedValue(ok());

    const first = await service.getOverview("장학금  신청", "skku-main", "ko", NOW);
    const second = await service.getOverview("장학금 신청", "skku-main", "ko", new Date(NOW.getTime() + 5 * 60_000));

    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.overview).toEqual(first.overview);
  });

  it("caches no_answer too", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok({ status: "no_answer", lead: null, points: [], sources: [] }));

    await service.getOverview("날씨", "skku-main", "ko", NOW);
    const again = await service.getOverview("날씨", "skku-main", "ko", NOW);

    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(again.meta).toEqual({ cached: true, reason: "no_answer" });
  });

  it("calls the ai again when a candidate's content changed", async () => {
    const { service, retriever, ai } = setup();
    const doc = candidate();
    retriever.retrieve.mockResolvedValueOnce([doc]).mockResolvedValueOnce([{ ...doc, contentHash: "edited" }]);
    ai.generate.mockResolvedValue(ok());

    await service.getOverview("장학금", "skku-main", "ko", NOW);
    await service.getOverview("장학금", "skku-main", "ko", NOW);

    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("calls the ai again on the next KST day", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate.mockResolvedValue(ok());

    await service.getOverview("장학금", "skku-main", "ko", new Date("2026-10-06T14:50:00Z"));
    await service.getOverview("장학금", "skku-main", "ko", new Date("2026-10-06T15:10:00Z"));

    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    ai.generate
      .mockResolvedValueOnce({ kind: "failed", httpStatus: 502, code: "llm_error" })
      .mockResolvedValueOnce(ok());

    const first = await service.getOverview("장학금", "skku-main", "ko", NOW);
    const second = await service.getOverview("장학금", "skku-main", "ko", NOW);

    expect(first.meta.reason).toBe("unavailable");
    expect(second.overview).not.toBeNull();
    expect(second.meta.cached).toBe(false);
    expect(ai.generate).toHaveBeenCalledTimes(2);
  });

  it("shares one ai call between concurrent identical requests", async () => {
    const { service, retriever, ai } = setup();
    retriever.retrieve.mockResolvedValue([candidate()]);
    let release!: (v: AiOverviewResult) => void;
    ai.generate.mockReturnValue(new Promise<AiOverviewResult>((r) => (release = r)));

    const a = service.getOverview("장학금", "skku-main", "ko", NOW);
    const b = service.getOverview("장학금", "skku-main", "ko", NOW);
    await new Promise((r) => setImmediate(r));
    release(ok());
    const [ra, rb] = await Promise.all([a, b]);

    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect([ra.meta.cached, rb.meta.cached].sort()).toEqual([false, true]);
    expect(ra.overview).toEqual(rb.overview);
  });
});
