import { Injectable } from "@nestjs/common";
import axios from "axios";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";

const TRAIN_MAP_URL = "https://smss.seoulmetro.co.kr/traininfo/traininfoUserMap.do";
const REQUEST_TIMEOUT_MS = 5_000;
const USER_AGENT = "skkuverse-server (+https://skkuverse.com)";
const UNEXPECTED_SHAPE = "unexpected_shape";
const OK_STATUS = 200;

@Injectable()
export class SubwaySeoulTrainmapClient {
  async fetchLinePage(line: string): Promise<string> {
    let data: unknown;
    try {
      ({ data } = await axios.post<unknown>(TRAIN_MAP_URL, null, {
        params: { line, isCb: "N" },
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        responseType: "text",
        headers: { "User-Agent": USER_AGENT },
      }));
    } catch (err: unknown) {
      throw this.toTrainmapError(line, err);
    }
    if (typeof data !== "string") throw new SubwaySeoulTrainmapError(`line ${line}: the page is not text`, OK_STATUS, UNEXPECTED_SHAPE);
    return data;
  }

  private toTrainmapError(line: string, err: unknown): SubwaySeoulTrainmapError {
    if (!axios.isAxiosError(err)) return new SubwaySeoulTrainmapError(`line ${line}: request failed`);
    const status = err.response?.status;
    const detail = status === undefined ? `request failed (${err.code ?? "no code"})` : `HTTP ${status}`;
    return new SubwaySeoulTrainmapError(`line ${line}: ${detail}`, status, err.code);
  }
}
