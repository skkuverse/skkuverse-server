import { z } from "zod";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/, "must be a decimal").transform(Number);
const wholeNumber = z.string().regex(/^\d+$/, "must be a whole number").transform(Number);

// QUIRK(topis): every value a string; gpsX is the WGS84 longitude and gpsY the latitude (posX/posY are TM).
export const topisRoutePoint = z.object({ no: wholeNumber, gpsX: decimal, gpsY: decimal });

export const topisRouteStation = z.object({
  station: z.string().min(1),
  arsId: z.string().min(1),
  stationNm: z.string().min(1),
  seq: wholeNumber,
  gpsX: decimal,
  gpsY: decimal,
  transYn: z.enum(["Y", "N"]),
});

// QUIRK(topis): `direction` names the terminal the bus heads to, flipping at the station after the turnaround; a row
// without one, or a blank one, says nothing, so it stays out of the fields every station needs.
export const topisRouteStationRow = topisRouteStation.extend({ direction: z.string().nullish().transform((direction) => direction?.trim() || null) });

// QUIRK(topis): `msgHeader.itemCount` reads 0 on a full answer, so only the list counts; `itemList` is null on "4".
export const topisRouteInfoAnswer = z.object({
  msgHeader: z.object({ headerCd: z.string(), headerMsg: z.string().nullish() }),
  msgBody: z.object({ itemList: z.array(z.unknown()).nullish() }).nullish(),
});

export type TopisRoutePoint = z.output<typeof topisRoutePoint>;
export type TopisRouteStation = z.output<typeof topisRouteStationRow>;
