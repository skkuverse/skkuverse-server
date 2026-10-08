import { Injectable } from "@nestjs/common";
import {
  StationHSSCStations,
  computeAllStationEtas,
} from "./station-eta";
import { BusCacheService } from "../cache/bus-cache.service";
import { HsscPollerService } from "../fetchers/hssc.poller.service";
import { StationPollerService } from "../fetchers/station.poller.service";

/**
 * /bus/station/:stationId handler body.
 *
 * For non-01592 stationIds returns an empty array (no totalCount meta). For
 * "01592" composes the exact 2-element body + { totalCount: 2 } meta, with the
 * ETA strings from computeAllStationEtas / StationHSSCStations (./station-eta).
 */
@Injectable()
export class StationService {
  constructor(
    private readonly cache: BusCacheService,
    private readonly hssc: HsscPollerService,
    private readonly station: StationPollerService,
  ) {}

  async getStationArrivals(
    stationId: string,
  ): Promise<{ data: unknown[]; meta?: { totalCount: number } }> {
    if (stationId !== "01592") {
      return { data: [] };
    }

    // `?? getHSSCBusList()` cache fallback: when cachedRead returns null, fall
    // back to the in-memory fetcher. cachedRead returns unknown (bus_cache is a
    // catch-all KV) — computeAllStationEtas's own Array.isArray check handles a
    // non-array, so the boundary cast is type-system bookkeeping only.
    const dynamicBusData =
      (await this.cache.cachedRead("hssc")) ?? this.hssc.getHSSCBusList();
    const stationsWithEta = computeAllStationEtas(
      StationHSSCStations,
      dynamicBusData as Parameters<typeof computeAllStationEtas>[1],
    );

    const hyehwaStation = stationsWithEta.find(
      (s) => s.stationName === "혜화역(승차장)",
    );
    const hsscEta = hyehwaStation ? hyehwaStation.eta : "도착 정보 없음";

    const stationMsg =
      (await this.cache.cachedRead("station")) ?? this.station.getStationInfo();

    return {
      data: [
        {
          busNm: "종로07",
          busSupportTime: true,
          msg1ShowMessage: true,
          msg1Message: stationMsg,
          msg1RemainStation: null,
          msg1RemainSeconds: null,
          msg2ShowMessage: false,
          msg2Message: null,
          msg2RemainStation: null,
          msg2RemainSeconds: null,
        },
        {
          busNm: "인사캠셔틀",
          busSupportTime: false,
          msg1ShowMessage: true,
          msg1Message: hsscEta,
          msg1RemainStation: null,
          msg1RemainSeconds: null,
          msg2ShowMessage: true,
          msg2Message: null,
          msg2RemainStation: null,
          msg2RemainSeconds: null,
        },
      ],
      meta: { totalCount: 2 },
    };
  }
}
