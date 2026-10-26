import { z } from "zod";
import { PUSH_PLACE_KINDS } from "./miniapps-notifications.constants";

export const idempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, { error: "Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _ and -" });

const CHIP_ID_MESSAGE = "chipId must be 1-64 characters of a-z, 0-9, _ and -, starting with a letter or digit";
const PLACE_ID_MESSAGE = `placeId must be [<kind>:]<id>, kind one of ${PUSH_PLACE_KINDS.join(", ")} and id 1-128 characters of a-z, 0-9 and -`;

// WHY: both anchors keep a path such as `../x` out; the app's own grammar has the same two.
const PLACE_ID_PATTERN = new RegExp(`^(?:(?:${PUSH_PLACE_KINDS.join("|")}):)?[a-z0-9-]{1,128}$`);

/**
 * WHY: where a current app opens the map for a push's route, as extra data keys installed builds ignore
 * (skkuverse-app ADR 0022, decision 7). A null key is no key, as for the English texts.
 */
export const pushMapTarget = z.object({
  chipId: z.string({ error: CHIP_ID_MESSAGE }).regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, { error: CHIP_ID_MESSAGE }).nullish(),
  placeId: z.string({ error: PLACE_ID_MESSAGE }).regex(PLACE_ID_PATTERN, { error: PLACE_ID_MESSAGE }).nullish(),
});

export type PushMapTarget = z.output<typeof pushMapTarget>;
