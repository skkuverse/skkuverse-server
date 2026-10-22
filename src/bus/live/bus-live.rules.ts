import type { Operation } from "../bus.wire";

// WHY: a group is over only when every station says so; one whose stations state nothing serves no data (ADR 0019, D8).
export function toGroupOperation(stations: ReadonlyArray<{ operation: Operation }>): Operation {
  if (stations.some(({ operation }) => operation === "running")) return "running";
  return stations.length > 0 && stations.every(({ operation }) => operation === "ended") ? "ended" : "noData";
}
