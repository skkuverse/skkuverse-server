import { z } from "zod";
import { isHex6 } from "../infra/color";
import { JOURNEY_ID_PATTERN, JOURNEY_PLACE_KINDS, JOURNEY_SOURCE_IDS, MAX_CATCH_MARGIN_SEC, MAX_LEG_MINUTES, MAX_WALK_DISTANCE_M, PLACE_REF_PATTERN } from "./journey.constants";
import type { JourneyRoutesData, StoredJourneyRoutes } from "./journey.document";

const NON_EMPTY = "required non-empty string";

const id = z.string().regex(JOURNEY_ID_PATTERN, "must be 1-128 characters of a-z, 0-9 and -");
const placeRef = z.string().regex(PLACE_REF_PATTERN, `must be <kind>:<id>, kind one of ${JOURNEY_PLACE_KINDS.join(", ")} and id 1-128 characters of a-z, 0-9 and -`);
const nonEmpty = z.string().trim().min(1, NON_EMPTY);
const localizedName = z.strictObject({ ko: nonEmpty, en: nonEmpty, zh: nonEmpty });
const minutes = z.int().min(1).max(MAX_LEG_MINUTES);
const evidence = z.string().trim().min(1, "required: where the minutes come from");
const rideMode = z.enum(["shuttle", "bus", "expressBus", "subway"]);
const platformId = z.string().min(1, NON_EMPTY);

const walkLeg = z.strictObject({
  kind: z.literal("walk"),
  from: placeRef,
  to: placeRef,
  minutes,
  distanceM: z.int().min(1).max(MAX_WALK_DISTANCE_M),
  evidence,
  path: z.array(z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).min(2).optional(),
});

const transferLeg = z.strictObject({ kind: z.literal("transfer"), at: placeRef, fromPlatformId: platformId, toPlatformId: platformId, minutes, evidence });

const legStop = z.strictObject({ place: placeRef, platformId: platformId.optional() });

const rideLeg = z.strictObject({ kind: z.literal("ride"), line: id, board: legStop, alight: legStop, rideMinutes: minutes, evidence });

const line = z.strictObject({
  id,
  source: z.enum(JOURNEY_SOURCE_IDS),
  sourceLineId: nonEmpty,
  mode: rideMode,
  name: localizedName,
  color: z.string().refine(isHex6, "must be 6-char hex string"),
  icon: nonEmpty,
});

const option = z.strictObject({ id, name: localizedName, mode: rideMode, legs: z.array(z.discriminatedUnion("kind", [walkLeg, transferLeg, rideLeg])).min(1) });

const route = z.strictObject({ id, name: localizedName, from: placeRef, to: placeRef, options: z.array(option).min(1) });

export const journeyRoutesDataset = z.strictObject({
  catchMarginSec: z.int().min(0).max(MAX_CATCH_MARGIN_SEC),
  lines: z.array(line),
  routes: z.array(route),
}) satisfies z.ZodType<JourneyRoutesData>;

export const storedJourneyRoutes = z.object({ revision: z.int().positive(), data: journeyRoutesDataset }) satisfies z.ZodType<StoredJourneyRoutes>;
