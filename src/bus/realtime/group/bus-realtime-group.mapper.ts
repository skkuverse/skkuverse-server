import type { CachedBusFields } from "./bus-realtime-group.types";
import type { RealtimeBus } from "./bus-realtime-group.wire";

const SEOUL_TIME_ZONE = "Asia/Seoul";

// WHY: latitude and longitude are left out, not null, when the source has none (HSSC never does); a Jongro
// route has no buses before its first tick.
export function toRealtimeBuses(buses: readonly CachedBusFields[] | undefined): RealtimeBus[] {
  return (buses ?? []).map((bus) => ({
    stationIndex: parseInt(bus.sequence, 10) - 1,
    carNumber: bus.carNumber,
    estimatedTime: bus.estimatedTime,
    ...(bus.latitude != null && { latitude: bus.latitude }),
    ...(bus.longitude != null && { longitude: bus.longitude }),
  }));
}

export function toClockTime(now: Date): string {
  return now.toLocaleTimeString("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
