import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { BusRealtimeHsscService } from "../../realtime/hssc/bus-realtime-hssc.service";
import { BusRealtimeHsscEtaService } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.service";
import type { HsscBusAnchor } from "../../realtime/hssc-eta/bus-realtime-hssc-eta.types";
import type { HsscLineStation } from "../../stops/bus-stops.document";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { LiveGroup } from "../bus-live.wire";
import { toLiveHsscGroup } from "./bus-live-hssc.mapper";
import type { HsscLiveBus, HsscLiveStation } from "./bus-live-hssc.types";

@Injectable()
export class BusLiveHsscService {
  constructor(
    private readonly hssc: BusRealtimeHsscService,
    private readonly eta: BusRealtimeHsscEtaService,
    private readonly stops: BusStopsService,
    private readonly clock: Clock,
  ) {}

  // WHY: each cached bus anchored on its latest stop event and estimated by the engine (ADR 0018); the stored HSSC line
  // names each station's stop (ADR 0019, D5), so stops never read answer their 503.
  async findLiveGroup(): Promise<LiveGroup> {
    const [{ events, checkedAt }, { hssc: line }] = await Promise.all([this.hssc.findStopEvents(), this.stops.current()]);
    const now = this.clock.now();
    const anchors = this.eta.toAnchors(events);
    const stations = anchors.length === 0 ? [] : this.toStations(anchors, line, now);
    return toLiveHsscGroup({ stations, buses: anchors.map((anchor) => this.toLiveBus(anchor, line, now)), checkedAt });
  }

  private toStations(anchors: readonly HsscBusAnchor[], line: readonly HsscLineStation[], now: Date): HsscLiveStation[] {
    return line.flatMap(({ stopId }, stationIndex) => (stopId === null ? [] : [{ stationIndex, stopId, etas: this.eta.toStationEtas(anchors, stationIndex, now) }]));
  }

  private toLiveBus(anchor: HsscBusAnchor, line: readonly HsscLineStation[], now: Date): HsscLiveBus {
    const stationIndex = this.eta.toStationIndex(anchor.seq);
    const [here] = this.eta.toStationEtas([anchor], stationIndex, now);
    return {
      anchor,
      stationIndex,
      isAtStopPosition: (line[stationIndex]?.stopId ?? null) !== null,
      departsAt: here?.status === "arriving" ? here.departsAt : null,
      lapTimes: this.eta.toLapTimes(anchor, now),
    };
  }
}
