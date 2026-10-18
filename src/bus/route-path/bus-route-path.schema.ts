import { z } from "zod";
import type { RoutePathStation } from "./bus-route-path.document";

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

// QUIRK(topis): `msgHeader.itemCount` reads 0 on a full answer, so only the list counts; `itemList` is null on "4".
export const topisRouteInfoAnswer = z.object({
  msgHeader: z.object({ headerCd: z.string(), headerMsg: z.string().nullish() }),
  msgBody: z.object({ itemList: z.array(z.unknown()).nullish() }).nullish(),
});

export type TopisRoutePoint = z.output<typeof topisRoutePoint>;
export type TopisRouteStation = z.output<typeof topisRouteStation>;

const seedStation = z.object({
  topisId: z.string().min(1),
  arsId: z.string().min(1),
  stationName: z.string().min(1),
  lng: z.number(),
  lat: z.number(),
  isTurnaround: z.boolean(),
}) satisfies z.ZodType<Omit<RoutePathStation, "sequence">>;

const seedEntry = z.object({
  id: z.string(),
  /** QUIRK(topis): the route's stops in TOPIS order, so stations[i] is TOPIS seq i + 1. */
  stations: z.array(seedStation).min(1),
  path: z.array(z.tuple([z.number(), z.number()])).min(1),
});

export const routePathsSeedFile = z.array(seedEntry);

export type RoutePathsSeedFile = z.output<typeof routePathsSeedFile>;
export type RoutePathSeedEntry = RoutePathsSeedFile[number];
