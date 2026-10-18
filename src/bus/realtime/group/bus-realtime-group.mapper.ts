import type { JongroBusPositionDoc } from "../../cache/bus-cache.document";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import type { CachedBusFields, JongroBusTracking } from "./bus-realtime-group.types";
import type { RealtimeBus, TrackedStatus } from "./bus-realtime-group.wire";

function toLegacyBusFields(bus: CachedBusFields) {
  return {
    stationIndex: parseInt(bus.sequence, 10) - 1,
    carNumber: bus.carNumber,
    estimatedTime: bus.estimatedTime,
    ...(bus.latitude != null && { latitude: bus.latitude }),
    ...(bus.longitude != null && { longitude: bus.longitude }),
  };
}

// WHY: latitude and longitude are left out, not null, when the source has none (HSSC never does); a Jongro
// route has no buses before its first tick.
export function toRealtimeBuses(buses: readonly CachedBusFields[] | undefined): RealtimeBus[] {
  return (buses ?? []).map(toEstimatedBus);
}

function toEstimatedBus(bus: CachedBusFields): RealtimeBus {
  return { ...toLegacyBusFields(bus), kind: "estimated" };
}

function toTracked({ status, vehicleId, observedAt, crowding, isLastBus, progress, segmentMeters, nextStopInSec }: JongroBusTracking): TrackedStatus {
  const common = { vehicleId, observedAt, crowding, isLastBus };
  return status === "running" ? { status, ...common, progress, segmentMeters, nextStopInSec } : { status, ...common };
}

export function toTrackedBus(position: JongroBusPositionDoc, tracking: JongroBusTracking): RealtimeBus {
  return { ...toLegacyBusFields(position), kind: "tracked", tracked: toTracked(tracking) };
}

export function toClockTime(now: Date): string {
  return now.toLocaleTimeString("en-US", {
    timeZone: KST_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
