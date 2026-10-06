import { Injectable } from "@nestjs/common";
import axios, { type AxiosResponse } from "axios";
import config from "../../infra/config";
import {
  parseAiOverviewResponse,
  type AiOverviewRequest,
  type AiOverviewResponse,
} from "./overview.contract";

/**
 * HTTP client for skkuverse-ai's POST /api/notices/overview.
 *
 * Contract: skkuverse-ai docs/notice-overview-api.md. The ai answers within
 * 20 s including one same-model retry, so anything shorter than 22 s would
 * cut it off mid-retry. Both an axios timeout and an AbortSignal are set: the
 * axios timeout alone is an idle-socket timer, and a server that trickles
 * bytes could hold the request past the response budget.
 *
 * Never throws. Every outcome becomes a result the service can act on; the
 * service owns logging, so no axios error object (config, headers) is ever
 * logged from here.
 */

export const AI_TIMEOUT_MS = 22_000;

export type AiOverviewResult =
  | { kind: "ok"; response: AiOverviewResponse }
  | { kind: "malformed" }
  | { kind: "budget_exhausted"; retryAt: Date | null }
  | { kind: "failed"; httpStatus: number | null; code: string | null };

/** `detail.code` from the ai's error body, when it has one (422 does not). */
function detailCode(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return null;
  }
  const code = (detail as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function retryAtOf(data: unknown): Date | null {
  const detail = (data as { detail?: { retryAt?: unknown } } | null)?.detail;
  const raw = detail?.retryAt;
  if (typeof raw !== "string") return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

function transportCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ECONNABORTED" || code === "ERR_CANCELED" || code === "ETIMEDOUT"
    ? "timeout"
    : "network_error";
}

@Injectable()
export class OverviewAiClient {
  async generate(body: AiOverviewRequest): Promise<AiOverviewResult> {
    const base = config.notices.overview.aiApiUrl!.replace(/\/+$/, "");
    let res: AxiosResponse<unknown>;
    try {
      res = await axios.post<unknown>(`${base}/api/notices/overview`, body, {
        timeout: AI_TIMEOUT_MS,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        validateStatus: () => true,
      });
    } catch (err: unknown) {
      return { kind: "failed", httpStatus: null, code: transportCode(err) };
    }

    if (res.status === 200) {
      const response = parseAiOverviewResponse(res.data);
      return response ? { kind: "ok", response } : { kind: "malformed" };
    }
    const code = detailCode(res.data);
    if (res.status === 503 && code === "budget_exhausted") {
      return { kind: "budget_exhausted", retryAt: retryAtOf(res.data) };
    }
    return { kind: "failed", httpStatus: res.status, code };
  }
}
