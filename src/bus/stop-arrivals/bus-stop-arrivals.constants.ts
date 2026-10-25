import type { Operation } from "../bus.wire";
import type { RunList } from "../eta/smart/bus-eta-smart.types";

// WHY: the owner's choice of how many runs a stop page lists per route (owner, 2026-10-21).
export const NEXT_RUN_COUNT = 3;

// WHY: a route that cannot be read stays so on every request; one line a minute, as docs/reference/logging.md asks.
export const LEFT_OUT_LOG_INTERVAL_MS = 60_000;

// WHY: like the live route, the page carries live positions and arrivals.
export const STOP_ARRIVALS_CACHE_CONTROL = "no-store";

// WHY: a commute service's label names its station for both directions, so up and down runs are headed as the HSSC
// line's live calls are, to campus and from campus; a route type not listed bears no direction (owner, 2026-10-25).
export const HEADSIGN_KEY_BY_ROUTE_TYPE: Readonly<Partial<Record<string, string>>> = {
  up: "busconfig.lineDirection.toCampus",
  down: "busconfig.lineDirection.fromCampus",
};

export const OPERATION_BY_SCHEDULE_STATUS: Readonly<Record<RunList["status"], Operation>> = {
  active: "running",
  suspended: "suspended",
  noData: "noData",
};
