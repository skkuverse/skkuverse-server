import { z } from "zod";

const stationArrival = z.object({
  busNm: z.string(),
  busSupportTime: z.boolean(),
  msg1ShowMessage: z.boolean(),
  msg1Message: z.string().nullable(),
  msg1RemainStation: z.null(),
  msg1RemainSeconds: z.null(),
  msg2ShowMessage: z.boolean(),
  msg2Message: z.string().nullable(),
  msg2RemainStation: z.null(),
  msg2RemainSeconds: z.null(),
});

/** WHY: no client in the sibling repositories reads this route; the shape is kept for installed apps that may. */
export const stationArrivals = z.array(stationArrival);

export const stationArrivalsMeta = z.object({ totalCount: z.int() });

export type StationArrivals = z.input<typeof stationArrivals>;
export type StationArrivalsMeta = z.input<typeof stationArrivalsMeta>;
