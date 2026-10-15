import { Injectable } from "@nestjs/common";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { BusCacheService } from "../cache/bus-cache.service";
import { BusRealtimeHsscService } from "../realtime/hssc/bus-realtime-hssc.service";
import { BusStationClient } from "./bus-station.client";
import { HSSC_ETA_STATIONS, HYEHWA_STATION_NAME, HYEHWA_STOP_ID, NO_ARRIVAL, NO_STATION_MESSAGE } from "./bus-station.constants";
import { toStationArrivals } from "./bus-station.mapper";
import { withHsscEtas } from "./bus-station.rules";
import type { StationArrivals, StationArrivalsMeta } from "./bus-station.wire";

@Injectable()
export class BusStationService {
  private message = NO_STATION_MESSAGE;

  constructor(
    private readonly client: BusStationClient,
    private readonly cache: BusCacheService,
    private readonly hssc: BusRealtimeHsscService,
  ) {}

  // WHY: rejects on a failed fetch or bus_cache write, so the poller registry reports the tick.
  async refresh(): Promise<void> {
    const messages = await this.client.fetchArrivalMessages();
    if (!messages) return;
    this.message = messages.length === 0 ? NO_STATION_MESSAGE : (messages[0] as string);
    await this.cache.write("station", this.message);
  }

  async listArrivals(stationId: string): Promise<StationArrivals | WithMeta<StationArrivals, StationArrivalsMeta>> {
    if (stationId !== HYEHWA_STOP_ID) return [];
    const buses = await this.hssc.listBuses();
    const hyehwa = withHsscEtas(HSSC_ETA_STATIONS, buses).find((s) => s.stationName === HYEHWA_STATION_NAME);
    const hsscEta = hyehwa ? hyehwa.eta : NO_ARRIVAL;
    const stationMessage = (await this.cache.read("station")) ?? this.message;
    return withMeta(toStationArrivals(stationMessage, hsscEta), { totalCount: 2 });
  }
}
