import { z } from "zod";

const latLng = z.object({ lat: z.number(), lng: z.number() });

/** WHY: every language in one body, so a shared cache may keep it; each is what a request in that language is served. */
const localizedText = z.object({ ko: z.string(), en: z.string(), zh: z.string() });

/** WHY: a realtime line's station at this stop, as a stop page's live entry names it, without arrivals. */
const liveRoute = z.object({
  kind: z.literal("live"),
  groupId: z.string(),
  label: localizedText,
  stationIndex: z.int().min(0),
  /** WHY: as a stop page heads it in each language: the next station with a stop; null at a line's last station. */
  towards: localizedText.nullable(),
  /** WHY: alight where riders may only get off (an HSSC drop-off-only stop), as the stop page's live entry says. */
  action: z.enum(["board", "alight"]),
});

/** WHY: a timetabled service at this stop; its label names the direction, so it carries no towards. */
const timetableRoute = z.object({
  kind: z.literal("timetable"),
  groupId: z.string(),
  label: localizedText,
  serviceId: z.string(),
  routeType: z.string(),
  action: z.enum(["board", "alight"]),
});

const listedStop = z.object({
  /** WHY: the id a stop page takes and a /bus/config station serves as `stopId`. */
  id: z.string(),
  name: localizedText,
  /** WHY: the stop's own, else its pole's on the stored route line; null until either is known. */
  coords: latLng.nullable(),
  /** WHY: the TOPIS ARS numbers of the poles it stands for; null for a local stop that aliases none. */
  arsIds: z.array(z.string()).nullable(),
  campus: z.enum(["hssc", "nsc"]).nullable(),
  /** WHY: in /bus/config's group order; `kind` is an open enum, and a client skips a kind it does not know. */
  routes: z.array(z.discriminatedUnion("kind", [liveRoute, timetableRoute])),
});

/** WHY: every stop a served route stops at, each once, for the map's pins and a line's station list. */
export const busStopList = z.object({
  stops: z.array(listedStop),
});

export type BusStopList = z.input<typeof busStopList>;
