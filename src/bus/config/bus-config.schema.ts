import { z } from "zod";

/** WHY: when the bus list shows a group: always, or from one KST date to another, inclusive. */
export const busGroupVisibility = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("always") }),
  z
    .strictObject({
      type: z.literal("dateRange"),
      from: z.iso.date(),
      fromTime: z.iso.time({ precision: -1 }).optional(),
      until: z.iso.date(),
    })
    // WHY: ISO dates order as strings; a swapped pair would parse and then hide the card on every day.
    .refine((range) => range.from <= range.until, { path: ["until"], message: "must not be before from" }),
]);
