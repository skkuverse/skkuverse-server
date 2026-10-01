import { Injectable, type OnModuleInit } from "@nestjs/common";
import axios from "axios";
import config from "../../infra/config";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { BusCacheService } from "../cache/bus-cache.service";
import { UpstreamError } from "./upstream-error";

// 혜화역 API 응답에서 우리가 읽는 부분만. itemList[0].arrmsg1만 사용.
interface HyehwaStationItem {
  arrmsg1: string;
  [k: string]: unknown;
}

interface HyehwaStationResponse {
  msgHeader?: { headerCd?: string; headerMsg?: string };
  msgBody?: {
    itemList?: HyehwaStationItem[];
  };
  [k: string]: unknown;
}

/**
 * 혜화역 정류장 안내 메시지 poller — exact port of
 * features/station/station.fetcher.ts. 매 40초 polling으로 갱신.
 */
@Injectable()
export class StationPollerService implements OnModuleInit {
  // 혜화역 정류장 안내 메시지 (API 응답의 첫 item.arrmsg1).
  private arrmsg1 = "정보 없음";

  constructor(
    private readonly registry: PollerRegistryService,
    private readonly cache: BusCacheService,
  ) {}

  onModuleInit(): void {
    // The registry logs failures as state transitions; see its header.
    this.registry.registerPoller(() => this.updateStation(), 40000, "station");
  }

  private async updateStation(): Promise<void> {
    const response = await axios.get<HyehwaStationResponse>(
      config.api.stationHyehwa!,
      { timeout: 10000 },
    );
    // 원본의 response.data?.msgBody?.itemList optional chaining 그대로 보존.
    // "0" = data, "4" = no result (keep the previous message); anything else
    // is an upstream error — an expired or throttled service key, for one.
    const header = response.data?.msgHeader;
    if (header?.headerCd === "4") return;
    if (header?.headerCd && header.headerCd !== "0") {
      throw new UpstreamError("TOPIS error code", "station", header.headerCd, header.headerMsg);
    }
    const apiData = response.data?.msgBody?.itemList;
    // Keeps the previous message. This was a silent return until 2026-10.
    if (!apiData) throw new UpstreamError("Station response has no itemList", "station");
    // apiData[0].arrmsg1 — apiData 길이 0이면 NO_INFO 사용.
    this.arrmsg1 = apiData.length === 0 ? "정보 없음" : apiData[0]!.arrmsg1;
    await this.cache.write("station", this.arrmsg1);
  }

  getStationInfo(): string {
    return this.arrmsg1;
  }
}
