import { Injectable } from "@nestjs/common";
import type { HsscStopEvent } from "../hssc/bus-realtime-hssc.types";
import { toHsscAnchor } from "./bus-realtime-hssc-eta.mapper";
import { toLapTimes, toSeq, toStationIndex, toStopEtas } from "./bus-realtime-hssc-eta.rules";
import type { HsscBusAnchor, HsscEta, HsscStationTime } from "./bus-realtime-hssc-eta.types";

// WHY: the engine's door for the live route, which speaks the HSSC line's station indexes, never the feed's seq.
@Injectable()
export class BusRealtimeHsscEtaService {
  toAnchors(events: readonly HsscStopEvent[]): HsscBusAnchor[] {
    return events.map(toHsscAnchor);
  }

  toStationEtas(anchors: readonly HsscBusAnchor[], stationIndex: number, now: Date): HsscEta[] {
    return toStopEtas(anchors, toSeq(stationIndex), now);
  }

  toLapTimes(anchor: HsscBusAnchor, now: Date): HsscStationTime[] {
    return toLapTimes(anchor, now).map(({ seq, arrivesAt, departsAt }) => ({ stationIndex: toStationIndex(seq), arrivesAt, departsAt }));
  }

  toStationIndex(seq: number): number {
    return toStationIndex(seq);
  }
}
