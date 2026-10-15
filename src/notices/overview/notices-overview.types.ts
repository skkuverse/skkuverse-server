import type { SupportedLang } from "../../infra/types";
import type { OverviewCandidate } from "./notices-overview.document";
import type { AiOverviewResponse } from "./notices-overview.schema";
import type { Overview, OverviewMeta } from "./notices-overview.wire";

type AiNoticeField = Exclude<keyof OverviewCandidate, "_id" | "sourceId" | "articleNo" | "title">;

// CONTRACT(skkuverse-ai): one element of `notices` in skkuverse-ai/docs/notice-overview-api.md, by DB field name.
export type AiOverviewNotice = { title: string } & { [K in AiNoticeField]-?: Exclude<OverviewCandidate[K], undefined> | null };

/** WHY: `notices[0]` is cited as 1: the ai cites by position, and the server maps positions back. */
export interface AiOverviewRequest {
  query: string;
  notices: AiOverviewNotice[];
  now: string;
  lang: string;
}

export type AiOverviewResult =
  | { kind: "ok"; response: AiOverviewResponse }
  | { kind: "malformed" }
  | { kind: "budget_exhausted"; retryAt: Date | null }
  | { kind: "failed"; httpStatus: number | null; code: string | null };

export type MapOverviewResult = { ok: true; overview: Overview } | { ok: false; reason: string };

export interface OverviewResult {
  overview: Overview | null;
  meta: OverviewMeta;
}

export type UnavailableCause =
  | { cause: "ai_failed"; httpStatus: number | null; code: string | null }
  | { cause: "budget_exhausted"; retryAt: Date | null }
  | { cause: "contract_violation"; reason: string };

export interface OverviewRequest {
  q: string;
  sourceIds: readonly string[];
  lang: SupportedLang;
}

export interface OverviewPipelineInput {
  q: string;
  sourceIds: readonly string[];
  serviceStartDate: string;
}
