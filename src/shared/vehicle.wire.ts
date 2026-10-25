import { z } from "zod";

const occupancyLevel = z.enum(["relaxed", "normal", "crowded"]);

/** WHY: what every mode says of a vehicle a call names, each once per response; unknown is null, never false or 0 (ADR 0022, D2). */
export const vehicle = z.object({
  id: z.string(),
  occupancy: z.object({ level: occupancyLevel, passengerCount: z.int().nullable() }).nullable(),
  /** WHY: seats still free, 0 when none; null when the source never reports seats or has no fresh answer. */
  seatsLeft: z.int().min(0).nullable(),
  isLowFloor: z.boolean().nullable(),
});

export type Vehicle = z.input<typeof vehicle>;
