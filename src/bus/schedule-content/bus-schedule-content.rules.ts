import moment from "moment-timezone";
import type { BusServiceNotices } from "./bus-schedule-content.schema";
import type { BusServiceReference } from "./bus-schedule-content.types";

const DATE_FORMAT = "YYYY-MM-DD";

/** WHY: strict, so a month or day that is out of range or not zero-padded is no date. */
export function isCalendarDate(value: string): boolean {
  return moment(value, DATE_FORMAT, true).isValid();
}

/** WHY: a push may name only services the code defines; the data tool resolves each against `busServices`. */
export function serviceNoticesReferences({ services }: BusServiceNotices): BusServiceReference[] {
  return Object.keys(services).map((serviceId) => ({ dataset: "busServices", id: serviceId, path: ["services", serviceId] }));
}
