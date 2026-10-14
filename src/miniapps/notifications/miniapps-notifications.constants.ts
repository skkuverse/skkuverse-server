/** WHY: enough of a title to recognise a send in the logs, without logging essays. */
export const LOG_TITLE_CHARS = 80;

// CONTRACT(skkuverse-app): `PLACE_KINDS` in skkuverse-app/packages/shared/src/utils/map-place-ref.rules.ts, the kinds
// a `placeId` may name; the app drops a reference whose kind it does not know.
export const PUSH_PLACE_KINDS: readonly string[] = ["skku_building", "event", "bus_stop", "subway_station"];

export const REUSED_IDEMPOTENCY_KEY_MESSAGE = "Idempotency-Key was already used for a different notification; send this one with a new key";

export const SIGNED_SEND_NEEDS_IDEMPOTENCY_KEY_MESSAGE = "a signed send needs an Idempotency-Key";

export const NO_RECORDED_OUTCOME_ERROR =
  "the first send with this Idempotency-Key has no recorded outcome yet; check the Cloud Function log for this notificationId";

// SEE: docs/decisions/0023-perimeter-ports.md ("D6. Signed calls") — the push routes, whose raw body a signed call needs.
export const RAW_BODY_ROUTE_PATHS: readonly string[] = [
  "/miniapps/:id/notifications",
];
