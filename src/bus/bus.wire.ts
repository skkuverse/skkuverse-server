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

export type JongroRoutesFile = z.input<typeof jongroRoutesFile>;
