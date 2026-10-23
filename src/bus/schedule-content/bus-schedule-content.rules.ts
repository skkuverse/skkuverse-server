import type { BusServiceNotices } from "./bus-schedule-content.schema";
import type { BusServiceReference } from "./bus-schedule-content.types";

/** WHY: a push may name only services the code defines; the data tool resolves each against `busServices`. */
export function serviceNoticesReferences({ services }: BusServiceNotices): BusServiceReference[] {
  return Object.keys(services).map((serviceId) => ({ dataset: "busServices", id: serviceId, path: ["services", serviceId] }));
}
