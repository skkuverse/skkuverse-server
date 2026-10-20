import { Injectable } from "@nestjs/common";
import type { JongroArrivalBus } from "../../cache/bus-cache.document";
import { BusRouteAttributesService } from "../../route-attributes/bus-route-attributes.service";
import type { Arrival } from "../group/bus-realtime-group.wire";
import { toArrival } from "./bus-realtime-arrival.rules";

@Injectable()
export class BusRealtimeArrivalService {
  constructor(private readonly routeAttributes: BusRouteAttributesService) {}

  // WHY: crowding compares a bus's passenger count with the route's stored seat count; with none, the group is a 503.
  async seatCountOf(routeId: string): Promise<number> {
    return (await this.routeAttributes.attributesOf(routeId)).seatCount;
  }

  // WHY: TOPIS leaves a slot's text empty when it names no bus for it.
  toArrivals(buses: readonly JongroArrivalBus[], seatCount: number): Arrival[] {
    return buses.filter((bus) => bus.arrmsg.trim() !== "").map((bus) => toArrival(bus, seatCount));
  }
}
