import type { HsscStopEvent } from "../hssc/bus-realtime-hssc.types";
import { isConfirmedDeparture } from "./bus-realtime-hssc-eta.rules";
import type { HsscBusAnchor } from "./bus-realtime-hssc-eta.types";

export function toHsscAnchor({ vehicleId, seq, inout, eventAt, firstSeenAt }: HsscStopEvent): HsscBusAnchor {
  const isDeparted = isConfirmedDeparture(seq, inout);
  return { vehicleId, seq, isDeparted, since: isDeparted ? eventAt : firstSeenAt, observedAt: eventAt };
}
