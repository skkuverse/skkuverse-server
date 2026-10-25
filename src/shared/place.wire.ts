import { z } from "zod";
import { latLng } from "./lat-lng.wire";
import { linkAction } from "./link-action.wire";

// WHY: one place vocabulary for links, pushes and journeys, snake_case as the link grammar is lowercase; an open
// enum, so a client draws a kind it does not know from its name and coords (ADR 0022, D4).
export const place = z.object({
  kind: z.enum(["bus_stop", "bus_stop_area", "subway_station", "skku_building", "point"]),
  /** WHY: the owning catalog's id verbatim; null only for the rider's own location. */
  id: z.string().nullable(),
  name: z.string(),
  coords: latLng,
  /** WHY: the subway platform (KRIC id) boarded or alighted at; an attribute, as KRIC ids are uppercase. */
  platformId: z.string().nullable(),
  /** WHY: where a tap goes; null when the place is not tappable. */
  action: linkAction.nullable(),
});

export type Place = z.input<typeof place>;
