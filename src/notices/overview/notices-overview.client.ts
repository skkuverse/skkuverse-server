import { Injectable } from "@nestjs/common";
import axios, { type AxiosResponse } from "axios";
import config from "../../infra/config";
import { isRecord } from "../../shared/object.util";
import { AI_TIMEOUT_MS } from "./notices-overview.constants";
import { parseAiOverviewResponse } from "./notices-overview.schema";
import type { AiOverviewRequest, AiOverviewResult } from "./notices-overview.types";

// CONTRACT(skkuverse-ai): POST /api/notices/overview (skkuverse-ai/docs/notice-overview-api.md). Never throws, and
// logs nothing: the service owns logging, so no axios error (config, headers) is ever logged from here.
@Injectable()
export class NoticesOverviewClient {
  // WHY: an AbortSignal beside the axios timeout, which is only an idle-socket timer a trickling server outlasts.
  async postOverview(body: AiOverviewRequest): Promise<AiOverviewResult> {
    const base = config.notices.overview.aiApiUrl.replace(/\/+$/, "");
    let res: AxiosResponse<unknown>;
    try {
      res = await axios.post<unknown>(`${base}/api/notices/overview`, body, {
        timeout: AI_TIMEOUT_MS,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        validateStatus: () => true,
      });
    } catch (err: unknown) {
      return { kind: "failed", httpStatus: null, code: this.transportCode(err) };
    }
    if (res.status === 200) {
      const response = parseAiOverviewResponse(res.data);
      return response ? { kind: "ok", response } : { kind: "malformed" };
    }
    const code = this.detailCode(res.data);
    if (res.status === 503 && code === "budget_exhausted") return { kind: "budget_exhausted", retryAt: this.retryAtOf(res.data) };
    return { kind: "failed", httpStatus: res.status, code };
  }

  // QUIRK(skkuverse-ai): `detail.code` on its own errors; a 422 from FastAPI has a list `detail` and no code.
  private detailCode(data: unknown): string | null {
    const detail = isRecord(data) ? data.detail : undefined;
    return isRecord(detail) && typeof detail.code === "string" ? detail.code : null;
  }

  private retryAtOf(data: unknown): Date | null {
    const detail = isRecord(data) ? data.detail : undefined;
    const raw = isRecord(detail) ? detail.retryAt : undefined;
    if (typeof raw !== "string") return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  private transportCode(err: unknown): string {
    const code = isRecord(err) ? err.code : undefined;
    return code === "ECONNABORTED" || code === "ERR_CANCELED" || code === "ETIMEDOUT" ? "timeout" : "network_error";
  }
}
