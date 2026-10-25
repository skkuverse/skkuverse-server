import type { Call } from "../../shared/call.wire";
import type { StoredTrainArrival } from "../subway.document";

// WHY: private: the labels follow Accept-Language, which a shared cache does not key on.
export const ARRIVALS_CACHE_CONTROL = "private, max-age=5";
// SEE: docs/reference/subway-api.md ("Call basis")
export const CALL_BASIS_BY_SOURCE: Readonly<Record<StoredTrainArrival["source"], Call["basis"]>> = { live: "provider", estimated: "estimate", scheduled: "timetable" };
