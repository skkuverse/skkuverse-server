import type { Call } from "./call.wire";

type CallInstantKey = "expectedArrivalAt" | "expectedDepartureAt" | "scheduledArrivalAt" | "scheduledDepartureAt";

/** WHY: the wire call field for field with Date instants, which only toCall formats, so no producer re-parses a served time. */
export type StopCall = Omit<Call, CallInstantKey> & Record<CallInstantKey, Date | null>;
