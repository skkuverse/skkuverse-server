import { z } from "zod";
import { instant } from "./instant.wire";

// WHY: one run's visit to one stop, every key present, null when unknown (ADR 0022, D2); status and basis are open
// enums, so a client skips, or renders the providerText of, a value it does not know (ADR 0019, D3).
export const call = z.object({
  status: z.enum(["arriving", "enRoute", "waitingToDepart", "scheduled", "unknown"]),
  expectedArrivalAt: instant.nullable(),
  expectedDepartureAt: instant.nullable(),
  scheduledArrivalAt: instant.nullable(),
  scheduledDepartureAt: instant.nullable(),
  basis: z.enum(["provider", "estimate", "timetable"]),
  /** WHY: the stops with a stop before this one, plus one: 1 approaching, 0 standing here (ADR 0019, D4). */
  stopsAway: z.int().min(0).nullable(),
  /** WHY: opaque, stable within one service day and one timetable revision; compared, never parsed (ADR 0022, D2). */
  runId: z.string().nullable(),
  /** WHY: a key of the response's vehicles; null for a call with no vehicle. */
  vehicleId: z.string().nullable(),
  headsign: z.string().nullable(),
  isFirstRun: z.boolean().nullable(),
  /** WHY: the one home of the last-run flag: on a board, the last run of its line and direction at this stop (ADR 0022, D2). */
  isLastRun: z.boolean().nullable(),
  isExpress: z.boolean().nullable(),
  /** WHY: the upstream's own text as received, in its language. */
  providerText: z.string().nullable(),
});

export type Call = z.input<typeof call>;
