import { Injectable } from "@nestjs/common";
import { AppError } from "../../common/app.error";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { NoticesSearchService } from "../search.service";
import { SourcesService } from "../sources.service";
import { OverviewAiClient } from "./overview.ai-client";
import { OverviewCache } from "./overview.cache";
import { overviewCacheKey } from "./overview.cache-key";
import { mapOverview } from "./overview.citations";
import {
  toAiNotice,
  type AiOverviewStatus,
  type OverviewCandidate,
  type OverviewDto,
  type OverviewReason,
} from "./overview.contract";
import { OverviewRetriever } from "./overview.retriever";
import { selectCandidates } from "./overview.select";

/**
 * GET /notices/overview — an AI answer for a notice search.
 *
 * Flow: validate → retrieve (hybrid, scoped like the list) → collapse
 * cross-posts and keep 6 → cache → skkuverse-ai → map citations.
 *
 * The overview is an extra on top of the search list, so it never fails the
 * request: every runtime failure becomes `overview: null` with
 * `reason: "unavailable"` and a log line. Only invalid input is an error (400).
 * Requirements: openspec/changes/add-notice-search-overview/specs.
 */

/** Same bound as GET /notices. */
const MAX_SOURCE_IDS = 20;

/** Upper bound on a budget pause, so a bad retryAt cannot disable the feature for days. */
export const MAX_BUDGET_PAUSE_MS = 24 * 60 * 60 * 1000;

type Generated =
  | { kind: "answer"; overview: OverviewDto; aiStatus: AiOverviewStatus }
  | { kind: "no_answer" };

type UnavailableCause =
  | { cause: "ai_failed"; httpStatus: number | null; code: string | null }
  | { cause: "budget_exhausted"; retryAt: Date | null }
  | { cause: "contract_violation"; reason: string };

/** Thrown out of the cached load so that the cache keeps nothing for it. */
class OverviewUnavailable extends Error {
  constructor(readonly detail: UnavailableCause) {
    super(`overview unavailable: ${detail.cause}`);
    this.name = "OverviewUnavailable";
  }
}

export interface OverviewResult {
  overview: OverviewDto | null;
  meta: { cached: boolean; reason?: OverviewReason };
}

interface Resolved {
  result: OverviewResult;
  candidates: number;
  aiStatus: string | null;
}

function unavailable(candidates: number, aiStatus: string | null): Resolved {
  return {
    result: { overview: null, meta: { cached: false, reason: "unavailable" } },
    candidates,
    aiStatus,
  };
}

@Injectable()
export class NoticesOverviewService {
  /** Epoch ms before which this replica does not call the ai (503 budget_exhausted). */
  private pausedUntil = 0;
  private readonly cache = new OverviewCache<Generated>();

  constructor(
    private readonly search: NoticesSearchService,
    private readonly sources: SourcesService,
    private readonly retriever: OverviewRetriever,
    private readonly ai: OverviewAiClient,
  ) {}

  async getOverview(
    rawQ: unknown,
    rawSourceIds: unknown,
    lang: SupportedLang,
    now: Date = new Date(),
  ): Promise<OverviewResult> {
    const sourceIds = this.parseSourceIds(rawSourceIds);
    const q = this.search.validateQ(rawQ);
    if (!q) {
      throw new AppError("INVALID_PARAMS", "q: 1-100 characters required", 400);
    }

    const startedAt = Date.now();
    const { result, candidates, aiStatus } = await this.resolve(
      q,
      sourceIds,
      lang,
      now,
    );
    logger.info(
      {
        event: "notices.overview.served",
        reason: result.meta.reason ?? null,
        cached: result.meta.cached,
        candidates,
        cites: result.overview ? result.overview.sources.length : 0,
        latencyMs: Date.now() - startedAt,
        aiStatus,
      },
      "Notice overview served",
    );
    return result;
  }

  /** Same rules and messages as GET /notices?sourceIds=. */
  private parseSourceIds(raw: unknown): string[] {
    const ids =
      typeof raw === "string"
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (ids.length === 0 || ids.length > MAX_SOURCE_IDS) {
      throw new AppError(
        "INVALID_PARAMS",
        `sourceIds: 1-${MAX_SOURCE_IDS} comma-separated source IDs required`,
        400,
      );
    }
    for (const id of ids) {
      if (!this.sources.map.has(id)) {
        throw new AppError("INVALID_SOURCE_ID", `unknown sourceId: ${id}`, 400);
      }
    }
    return ids;
  }

  private async resolve(
    q: string,
    sourceIds: string[],
    lang: SupportedLang,
    now: Date,
  ): Promise<Resolved> {
    if (now.getTime() < this.pausedUntil) return unavailable(0, "paused");

    let ranked: OverviewCandidate[];
    try {
      ranked = await this.retriever.retrieve(q, sourceIds);
    } catch (err: unknown) {
      logger.error(
        { event: "notices.overview.retrieval_failed", err },
        "Notice overview retrieval failed",
      );
      return unavailable(0, null);
    }

    const candidates = selectCandidates(ranked);
    if (candidates.length === 0) {
      return {
        result: { overview: null, meta: { cached: false, reason: "no_results" } },
        candidates: 0,
        aiStatus: null,
      };
    }

    const key = overviewCacheKey({ q, sourceIds, lang, now, candidates });
    try {
      const { value, cached } = await this.cache.get(key, () =>
        this.generate(q, candidates, lang, now),
      );
      if (value.kind === "no_answer") {
        return {
          result: { overview: null, meta: { cached, reason: "no_answer" } },
          candidates: candidates.length,
          aiStatus: "no_answer",
        };
      }
      return {
        result: { overview: value.overview, meta: { cached } },
        candidates: candidates.length,
        aiStatus: value.aiStatus,
      };
    } catch (err: unknown) {
      if (err instanceof OverviewUnavailable) {
        this.onUnavailable(err.detail, now);
        return unavailable(candidates.length, err.detail.cause);
      }
      // A bug, not an ai outcome. Still not a 5xx: the spec keeps the overview
      // from ever failing the request, so it is logged at error and degraded.
      logger.error(
        { event: "notices.overview.failed", err },
        "Notice overview failed unexpectedly",
      );
      return unavailable(candidates.length, null);
    }
  }

  private async generate(
    q: string,
    candidates: OverviewCandidate[],
    lang: SupportedLang,
    now: Date,
  ): Promise<Generated> {
    const res = await this.ai.generate({
      query: q,
      notices: candidates.map(toAiNotice),
      now: now.toISOString(),
      lang,
    });
    switch (res.kind) {
      case "ok": {
        if (res.response.status === "no_answer") return { kind: "no_answer" };
        const mapped = mapOverview(candidates, res.response, new Date());
        if (!mapped.ok) {
          throw new OverviewUnavailable({
            cause: "contract_violation",
            reason: mapped.reason,
          });
        }
        return {
          kind: "answer",
          overview: mapped.overview,
          aiStatus: res.response.status,
        };
      }
      case "malformed":
        throw new OverviewUnavailable({
          cause: "contract_violation",
          reason: "malformed_response",
        });
      case "budget_exhausted":
        throw new OverviewUnavailable({
          cause: "budget_exhausted",
          retryAt: res.retryAt,
        });
      case "failed":
        throw new OverviewUnavailable({
          cause: "ai_failed",
          httpStatus: res.httpStatus,
          code: res.code,
        });
    }
  }

  private onUnavailable(detail: UnavailableCause, now: Date): void {
    switch (detail.cause) {
      case "budget_exhausted": {
        const retryAt = detail.retryAt;
        if (retryAt && retryAt.getTime() > now.getTime()) {
          this.pausedUntil = Math.min(
            retryAt.getTime(),
            now.getTime() + MAX_BUDGET_PAUSE_MS,
          );
          logger.warn(
            {
              event: "notices.overview.budget_paused",
              retryAt: retryAt.toISOString(),
            },
            "Notice overview paused until the ai budget resets",
          );
        } else {
          logger.warn(
            {
              event: "notices.overview.ai_failed",
              httpStatus: 503,
              code: "budget_exhausted",
            },
            "Notice overview ai call failed",
          );
        }
        return;
      }
      case "ai_failed":
        logger.warn(
          {
            event: "notices.overview.ai_failed",
            httpStatus: detail.httpStatus,
            code: detail.code,
          },
          "Notice overview ai call failed",
        );
        return;
      case "contract_violation":
        logger.error(
          {
            event: "notices.overview.contract_violation",
            reason: detail.reason,
          },
          "Notice overview ai response broke the contract",
        );
        return;
    }
  }
}
