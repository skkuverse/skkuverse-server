import { z } from "zod";

// QUIRK(gbis): one bus of getBusLocationListv2, its numbers JSON numbers; vehId is the id TOPIS gives the same bus
// (2026-10-24 capture). Its other fields (plateNo, stationSeq, crowded, lowPlate, stateCd …) are not read.
export const gbisBusLocation = z.object({
  vehId: z.int(),
  remainSeatCnt: z.int(),
});

export type GbisBusLocation = z.output<typeof gbisBusLocation>;

// QUIRK(gbis): msgBody may be left out when resultCode says there is nothing; a list of one may come as the object
// itself, as getBusArrivalItemv2 answers its one item (2026-10-24 capture).
export const gbisLocationAnswer = z.object({
  response: z.object({
    msgHeader: z.object({ resultCode: z.int(), resultMessage: z.string().nullish() }),
    msgBody: z.object({ busLocationList: z.union([z.array(gbisBusLocation), gbisBusLocation]) }).nullish(),
  }),
});
