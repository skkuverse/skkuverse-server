import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { KeyedCache } from "../../infra/keyed-cache";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { NoticesOverviewClient } from "./notices-overview.client";
import { MAX_BUDGET_PAUSE_MS, OVERVIEW_CACHE_MAX_KEYS, OVERVIEW_CACHE_TTL_MS } from "./notices-overview.constants";
import { NoticesOverviewUnavailableError } from "./notices-overview.error";
import { mapOverview, toAiNotice } from "./notices-overview.mapper";
import { NoticesOverviewRepository } from "./notices-overview.repository";
import { overviewCacheKey, selectCandidates } from "./notices-overview.rules";
import type { AiOverviewStatus } from "./notices-overview.schema";
import type { OverviewCandidate, OverviewRequest, OverviewResult, UnavailableCause } from "./notices-overview.types";
import type { Overview } from "./notices-overview.wire";

type Generated = { kind: "answer"; overview: Overview; aiStatus: AiOverviewStatus } | { kind: "no_answer" };

interface Resolved {
  result: OverviewResult;
  candidates: number;
  aiStatus: string | null;
}

const UNAVAILABLE: OverviewResult = { overview: null, meta: { cached: false, reason: "unavailable" } };

// WHY: an extra on top of the search list, so it never fails the request: a runtime failure is `overview: null`
// with reason "unavailable" and a log line; bad input is a 400 from `overviewRequest` before it gets here.
@Injectable()
export class NoticesOverviewService {
  private pausedUntil = 0;
  private readonly cache = new KeyedCache<Generated>(OVERVIEW_CACHE_TTL_MS, OVERVIEW_CACHE_MAX_KEYS, "notices.overview");

  constructor(
    private readonly repository: NoticesOverviewRepository,
    private readonly client: NoticesOverviewClient,
    private readonly clock: Clock,
  ) {}

  async getOverview({ q: searchText, sourceIds, lang }: OverviewRequest): Promise<OverviewResult> {
    const now = this.clock.now();
    const startedAt = now.getTime();
    const { result, candidates, aiStatus } = await this.resolve(searchText, sourceIds, { lang, now });
    logger.info(
      {
        event: "notices.overview.served",
        reason: result.meta.reason ?? null,
        cached: result.meta.cached,
        candidates,
        cites: result.overview ? result.overview.sources.length : 0,
        latencyMs: this.clock.now().getTime() - startedAt,
        aiStatus,
      },
      "Notice overview served",
    );
    return result;
  }

  private async resolve(searchText: string, sourceIds: readonly string[], request: { lang: SupportedLang; now: Date }): Promise<Resolved> {
    if (request.now.getTime() < this.pausedUntil) return { result: UNAVAILABLE, candidates: 0, aiStatus: "paused" };
    let ranked: OverviewCandidate[];
    try {
      ranked = await this.repository.searchCandidates(searchText, sourceIds);
    } catch (err: unknown) {
      logger.error({ event: "notices.overview.retrieval_failed", err }, "Notice overview retrieval failed");
      return { result: UNAVAILABLE, candidates: 0, aiStatus: null };
    }
    const candidates = selectCandidates(ranked);
    if (candidates.length === 0) {
      return { result: { overview: null, meta: { cached: false, reason: "no_results" } }, candidates: 0, aiStatus: null };
    }
    const key = overviewCacheKey({ q: searchText, sourceIds, lang: request.lang, now: request.now, candidates });
    return this.answer(key, () => this.generate(searchText, candidates, request), { count: candidates.length, now: request.now });
  }

  private async answer(key: string, load: () => Promise<Generated>, at: { count: number; now: Date }): Promise<Resolved> {
    try {
      const { value, cached } = await this.cache.get(key, load);
      if (value.kind === "no_answer") {
        return { result: { overview: null, meta: { cached, reason: "no_answer" } }, candidates: at.count, aiStatus: "no_answer" };
      }
      return { result: { overview: value.overview, meta: { cached } }, candidates: at.count, aiStatus: value.aiStatus };
    } catch (err: unknown) {
      if (err instanceof NoticesOverviewUnavailableError) {
        this.onUnavailable(err.detail, at.now);
        return { result: UNAVAILABLE, candidates: at.count, aiStatus: err.detail.cause };
      }
      // WHY: a bug, not an ai outcome, and still not a 5xx: the overview never fails the request.
      logger.error({ event: "notices.overview.failed", err }, "Notice overview failed unexpectedly");
      return { result: UNAVAILABLE, candidates: at.count, aiStatus: null };
    }
  }

  private async generate(searchText: string, candidates: OverviewCandidate[], request: { lang: SupportedLang; now: Date }): Promise<Generated> {
    const res = await this.client.postOverview({
      query: searchText,
      notices: candidates.map(toAiNotice),
      now: request.now.toISOString(),
      lang: request.lang,
    });
    switch (res.kind) {
      case "ok": {
        if (res.response.status === "no_answer") return { kind: "no_answer" };
        const mapped = mapOverview(candidates, res.response, this.clock.now());
        if (!mapped.ok) throw new NoticesOverviewUnavailableError({ cause: "contract_violation", reason: mapped.reason });
        return { kind: "answer", overview: mapped.overview, aiStatus: res.response.status };
      }
      case "malformed":
        throw new NoticesOverviewUnavailableError({ cause: "contract_violation", reason: "malformed_response" });
      case "budget_exhausted":
        throw new NoticesOverviewUnavailableError({ cause: "budget_exhausted", retryAt: res.retryAt });
      case "failed":
        throw new NoticesOverviewUnavailableError({ cause: "ai_failed", httpStatus: res.httpStatus, code: res.code });
    }
  }

  private onUnavailable(detail: UnavailableCause, now: Date): void {
    if (detail.cause === "budget_exhausted" && detail.retryAt && detail.retryAt.getTime() > now.getTime()) {
      this.pausedUntil = Math.min(detail.retryAt.getTime(), now.getTime() + MAX_BUDGET_PAUSE_MS);
      logger.warn({ event: "notices.overview.budget_paused", retryAt: detail.retryAt.toISOString() }, "Notice overview paused until the ai budget resets");
      return;
    }
    if (detail.cause === "contract_violation") {
      logger.error({ event: "notices.overview.contract_violation", reason: detail.reason }, "Notice overview ai response broke the contract");
      return;
    }
    const fields = detail.cause === "ai_failed" ? { httpStatus: detail.httpStatus, code: detail.code } : { httpStatus: 503, code: "budget_exhausted" };
    logger.warn({ event: "notices.overview.ai_failed", ...fields }, "Notice overview ai call failed");
  }
}
