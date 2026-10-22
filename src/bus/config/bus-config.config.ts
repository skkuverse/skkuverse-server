import { busGroupVisibility } from "./bus-config.schema";
import type { BusGroupVisibility, GroupStops } from "./bus-config.types";

// WHY: parsed where it is written, so a typo in a date or time fails the boot instead of silently hiding the card.
export function dateRange(from: string, until: string, fromTime?: string): BusGroupVisibility {
  const visibility: BusGroupVisibility =
    fromTime === undefined ? { type: "dateRange", from, until } : { type: "dateRange", from, fromTime, until };
  busGroupVisibility.parse(visibility);
  return visibility;
}

export const FASTTRACK_VISIBILITY = dateRange("2026-03-01", "2026-03-07");

// WHY: the commute shuttle card opens with the school's notice, a week before the first run (2026-10-19), and
// its smart view opens on that run. SEE: docs/project-docs.md (Visibility)
export const COMMUTE_VISIBILITY = dateRange("2026-10-12", "2026-12-18", "11:55");

// WHY: the owner hid the commute stops' map cards on 2026-10-18; the catalog keeps every
// guide, since the campus group serves nsc-n-center and nsc-opposite too.
export const HAS_STOP_MAPS_BY_GROUP = { campus: true, commute: false } as const satisfies Record<keyof GroupStops, boolean>;
