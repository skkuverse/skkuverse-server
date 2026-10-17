import { Injectable } from "@nestjs/common";
import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import type { Arrival } from "../group/bus-realtime-group.wire";
import { toArrival } from "./bus-realtime-arrival.rules";

@Injectable()
export class BusRealtimeArrivalService {
  // WHY: TOPIS leaves a slot's text empty when it names no bus for it.
  toArrivals(buses: readonly JongroArrivalBus[], seatCount: number): Arrival[] {
    return buses.filter((bus) => bus.arrmsg.trim() !== "").map((bus) => toArrival(bus, seatCount));
  }
}
