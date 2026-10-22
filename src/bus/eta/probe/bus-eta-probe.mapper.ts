import type { BusLaneSpanDoc } from "./bus-eta-probe.document";
import type { LaneSpan } from "./bus-eta-probe.types";

// WHY: 90 days hold a season of spans for the time-of-day profile (ADR 0015, D8); they are public data only.
const SPAN_LIFE_MS = 90 * 24 * 60 * 60_000;

export function spanDoc(span: LaneSpan): BusLaneSpanDoc {
  return {
    _id: `${span.routeId}|${span.vehId}|${span.fromAt.toISOString()}|${span.toAt.toISOString()}`,
    ...span,
    expiresAt: new Date(span.toAt.getTime() + SPAN_LIFE_MS),
  };
}
