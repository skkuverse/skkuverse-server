import { z } from "zod";
import { call } from "../../shared/call.wire";
import { instant } from "../../shared/instant.wire";
import { latLng } from "../../shared/lat-lng.wire";
import { place } from "../../shared/place.wire";
import { vehicle } from "../../shared/vehicle.wire";

const rideMode = z.enum(["shuttle", "bus", "expressBus", "subway"]);

// WHY: every leg can be drawn from these alone: a client draws a kind it does not know as a generic row and an
// unknown mode or icon with the generic icon; mode is open (ADR 0022, D5).
const legBase = {
  mode: z.enum([...rideMode.options, "walk"]),
  from: place,
  to: place,
  startAt: instant,
  endAt: instant,
  /** WHY: a ride's is the weaker of its board and alight calls, a walk's or transfer's an estimate. */
  basis: call.shape.basis,
  durationSec: z.int().min(0),
  distanceM: z.int().min(0).nullable(),
  /** WHY: made by the server, the label in the request language, the icon an open key, the color hex6 or none. */
  label: z.string(),
  icon: z.string(),
  color: z.string().nullable(),
};

const rideLeg = z.object({
  kind: z.literal("ride"),
  ...legBase,
  line: z.object({ id: z.string(), name: z.string() }),
  board: call,
  alight: call,
  /** WHY: the next catchable calls at the board stop after the one boarded, at most two. */
  later: z.array(call).max(2),
  vehicles: z.array(vehicle),
  waitSec: z.int().min(0),
  /** WHY: when the source wrote what the board was read from; null for a published timetable. */
  observedAt: instant.nullable(),
});

const walkLeg = z.object({ kind: z.literal("walk"), ...legBase, path: z.array(latLng).nullable() });
const transferLeg = z.object({ kind: z.literal("transfer"), ...legBase });

// WHY: kind is an open enum; a client skips no leg, drawing one of a kind it does not know from the base (ADR 0019, D3).
const option = z.object({
  id: z.string(),
  name: z.string(),
  mode: rideMode,
  status: z.enum(["running", "notRunning"]),
  reason: z.enum(["ended", "notStarted", "unavailable"]).nullable(),
  /** WHY: the next departure when no run is left, later this service day when `notStarted`; null otherwise or when unknown. */
  nextServiceAt: instant.nullable(),
  leaveAt: instant.nullable(),
  arriveAt: instant.nullable(),
  legs: z.array(z.discriminatedUnion("kind", [rideLeg, walkLeg, transferLeg])),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});

export const journeyRoutes = z.object({ routes: z.array(z.object({ id: z.string(), name: z.string(), from: place, to: place, options: z.array(option) })) });

export const journeyRoutesMeta = z.object({ serverNow: instant });

export type JourneyRoutes = z.input<typeof journeyRoutes>;
export type JourneyRoutesMeta = z.input<typeof journeyRoutesMeta>;
