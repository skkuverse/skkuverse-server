import { z } from "zod";

const transferLine = z.object({
  line: z.string(),
  color: z.string(),
});

const jongroRouteEntry = z.object({
  id: z.string(),
  busRouteId: z.string(),
  themeColor: z.string(),
  iconType: z.string(),
  refreshInterval: z.number(),
  /** WHY: crowding compares a bus's passenger count with this; 18 is a 9 m village bus until the real count is known. */
  seatCount: z.number(),
  /** WHY: keyed by ARS number, so a stop's subway badges follow it when TOPIS moves it in the list. */
  transferLinesByArsId: z.record(z.string(), z.array(transferLine)),
});

/**
 * CONTRACT(skkuverse-crawler): skkuverse-crawler/py/src/skkuverse_crawler/modules/bus/registry.py reads a copy of
 * this file's older shape, with stations; the stations now live in `jongro_routes`, which its paused bus module
 * must read before it is re-enabled.
 */
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
