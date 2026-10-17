import moment from "moment-timezone";
import { z } from "zod";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/, "must be a decimal").transform(Number);

// QUIRK(topis): `dataTm` is the GPS fix's KST wall time as yyyyMMddHHmmss.
const DATA_TM_FORMAT = "YYYYMMDDHHmmss";
const kstDataTm = z
  .string()
  .refine((value) => moment.tz(value, DATA_TM_FORMAT, true, KST_TIME_ZONE).isValid(), "must be yyyyMMddHHmmss")
  .transform((value) => moment.tz(value, DATA_TM_FORMAT, true, KST_TIME_ZONE).toDate());

export const topisPosition = z.object({
  vehId: z.string().min(1),
  gpsX: decimal,
  gpsY: decimal,
  sectOrd: z.string().regex(/^\d+$/, "must be a whole number").transform(Number),
  dataTm: kstDataTm,
});

// QUIRK(topis): `itemList` is null on "4" (no result); a list of one may arrive as the object itself.
export const topisPositionList = z.object({
  msgHeader: z.object({ headerCd: z.string() }),
  msgBody: z.object({ itemList: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).nullish() }).nullish(),
});
