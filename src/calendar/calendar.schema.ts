import { z } from "zod";
import type { StoredRestDays } from "./calendar.document";
import { isRestDayKey, toRestDays } from "./calendar.rules";

export const skkuRestDaysDataset = z
  .record(z.string(), z.string().min(1))
  .superRefine((labelByKey, ctx) => {
    for (const key of Object.keys(labelByKey)) {
      if (!isRestDayKey(key)) ctx.addIssue({ code: "custom", path: [key], message: "must be a calendar MM-DD or a calendar YYYY-MM-DD from 1900 to 2999" });
    }
  })
  .transform(toRestDays);

export const storedRestDays = z.object({ revision: z.int().positive(), data: skkuRestDaysDataset }) satisfies z.ZodType<StoredRestDays>;
