import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { z } from "zod";
import config from "../../infra/config";
import { SubwaySeoulApiError } from "./subway-seoul-api.error";
import {
  seoulApiStatus,
  seoulArrivalBody,
  seoulPositionBody,
  type SeoulArrivalRow,
  type SeoulPositionRow,
} from "./subway-seoul-api.schema";

const API_ROOT = "http://swopenapi.seoul.go.kr/api/subway";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_POSITION_ROWS = 400;
const MAX_ARRIVAL_ROWS = 50;
const SUCCESS_CODE = "INFO-000";
// QUIRK(seoul-subway-api): "no data" is a code, not an empty list; a station answers it at night.
const NO_DATA_CODE = "INFO-200";
const UNEXPECTED_SHAPE = "unexpected_shape";
const OK_STATUS = 200;

type Endpoint = "realtimePosition" | "realtimeStationArrival";

@Injectable()
export class SubwaySeoulApiClient {
  async fetchPositions(lineName: string): Promise<SeoulPositionRow[]> {
    const body = await this.fetchBody("realtimePosition", MAX_POSITION_ROWS, lineName);
    return this.parseRows("realtimePosition", body, seoulPositionBody)?.realtimePositionList ?? [];
  }

  async fetchArrivals(stationName: string): Promise<SeoulArrivalRow[]> {
    const body = await this.fetchBody("realtimeStationArrival", MAX_ARRIVAL_ROWS, stationName);
    return this.parseRows("realtimeStationArrival", body, seoulArrivalBody)?.realtimeArrivalList ?? [];
  }

  // QUIRK(seoul-subway-api): the key travels in the path, so a failure keeps only its status and code.
  private async fetchBody(endpoint: Endpoint, maxRows: number, name: string): Promise<unknown> {
    const key = encodeURIComponent(config.subway.seoulApiKey);
    try {
      const { data } = await axios.get<unknown>(`${API_ROOT}/${key}/json/${endpoint}/0/${maxRows}/${encodeURIComponent(name)}`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      return data;
    } catch (err: unknown) {
      throw this.toApiError(endpoint, err);
    }
  }

  private parseRows<T>(endpoint: Endpoint, body: unknown, schema: z.ZodType<T>): T | null {
    const wrapped = (body as { errorMessage?: unknown } | null)?.errorMessage;
    const status = seoulApiStatus.safeParse(wrapped ?? body);
    if (!status.success) throw new SubwaySeoulApiError(`${endpoint}: no status in the body`, OK_STATUS, UNEXPECTED_SHAPE);
    const { code } = status.data;
    if (code === NO_DATA_CODE) return null;
    if (code !== SUCCESS_CODE) throw new SubwaySeoulApiError(`${endpoint}: refused (${code})`, status.data.status, code);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new SubwaySeoulApiError(`${endpoint}: not the expected rows`, OK_STATUS, UNEXPECTED_SHAPE);
    return parsed.data;
  }

  private toApiError(endpoint: Endpoint, err: unknown): SubwaySeoulApiError {
    if (!axios.isAxiosError(err)) return new SubwaySeoulApiError(`${endpoint}: request failed`);
    const status = err.response?.status;
    const detail = status === undefined ? `request failed (${err.code ?? "no code"})` : `HTTP ${status}`;
    return new SubwaySeoulApiError(`${endpoint}: ${detail}`, status, err.code);
  }
}
