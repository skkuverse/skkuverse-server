import { z } from "zod";

const KST_DATE = /^\d{4}-\d{2}-\d{2}$/;
const serviceDate = z.string().regex(KST_DATE, { error: "must be a KST date, YYYY-MM-DD" });

// WHY: service dates, not instants: a record's service date is the day its train runs under, past midnight included.
export const accuracyQuery = z
  .object({ from: serviceDate, to: serviceDate })
  .refine((range) => range.from <= range.to, { error: "to must not be before from", path: ["to"] });
