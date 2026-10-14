import { z } from "zod";

const transferLine = z.object({
  line: z.string(),
  color: z.string(),
});

const jongroRouteStation = z.object({
  stationName: z.string(),
  arsId: z.string(),
  /** QUIRK(topis): the stop's station ID, the `stId` and `lastStnId` TOPIS answers with. */
  topisId: z.string(),
  isFirstStation: z.boolean(),
  isLastStation: z.boolean(),
  isRotationStation: z.boolean(),
  transferLines: z.array(transferLine),
});

const jongroRouteEntry = z.object({
  id: z.string(),
  busRouteId: z.string(),
  themeColor: z.string(),
  iconType: z.string(),
  refreshInterval: z.number(),
  /** QUIRK(topis): the route's stops in TOPIS order, so stations[i] is TOPIS ord i + 1. */
  stations: z.array(jongroRouteStation),
});

/** CONTRACT(skkuverse-crawler): a copy of this file is read by skkuverse-crawler/py/src/skkuverse_crawler/modules/bus/registry.py. */
export const jongroRoutesFile = z.array(jongroRouteEntry);

const latLng = z.object({ lat: z.number(), lng: z.number() });

/** WHY: a stop of a run as a schedule service's `stopSequences` serves it, named in the request language. */
export const servedSequenceStop = z.object({
  label: z.string(),
  action: z.enum(["board", "alight"]),
  timing: z.enum(["scheduled", "estimated"]),
  stopId: z.string().optional(),
  note: z.string().optional(),
  detail: z.string().optional(),
});

export const stopMap = z.object({
  markers: z.array(z.object({ id: z.string(), kind: z.literal("subwayExit"), label: z.string(), number: z.int(), coords: latLng })),
  paths: z.array(z.object({ kind: z.literal("walk"), from: z.string(), to: z.string(), points: z.array(latLng) })),
});

export const servedStop = z.object({
  id: z.string(),
  name: z.string(),
  detail: z.string().optional(),
  coords: latLng.optional(),
  photoUrl: z.string().optional(),
  streetViewUrl: z.string().optional(),
  map: stopMap.optional(),
});

export type JongroRoutesFile = z.input<typeof jongroRoutesFile>;
export type ServedSequenceStop = z.input<typeof servedSequenceStop>;
export type StopMap = z.input<typeof stopMap>;
export type ServedStop = z.input<typeof servedStop>;
