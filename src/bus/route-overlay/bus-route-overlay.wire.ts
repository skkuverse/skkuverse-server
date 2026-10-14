import { z } from "zod";

/** WHY: no client in the sibling repositories reads this route; the shape is kept for installed apps that may. */
export const routeOverlay = z.object({
  color: z.string(),
  /** WHY: [latitude, longitude] pairs. */
  coords: z.array(z.tuple([z.number(), z.number()])),
});

export type RouteOverlay = z.input<typeof routeOverlay>;
