import { pick } from "../infra/i18n";
import type { I18n, SupportedLang } from "../infra/types";
import { toKstInstant } from "../shared/kst-date.util";
import type { StopCall } from "./bus.types";
import type { Arrival } from "./bus.wire";

type LineStation = { name: string; stopId: string | null };

/** WHY: each stop of the HSSC line named as its own stop page names it; a position with no stop keeps the line's name. */
export function toCatalogNamedLine(line: readonly LineStation[], stops: ReadonlyArray<{ id: string; name: I18n }>, lang: SupportedLang): LineStation[] {
  return line.map(({ name, stopId }) => {
    if (stopId === null) return { name, stopId };
    const stop = stops.find((candidate) => candidate.id === stopId);
    if (!stop) throw new Error(`bus-stops: the HSSC line names stop ${stopId}, which a push refuses`);
    return { name: pick(stop.name, lang) ?? stop.name.ko, stopId };
  });
}

const toServedInstant = (at: Date | null): string | null => (at === null ? null : toKstInstant(at.getTime()));

/** WHY: in the call's own key order, its instants replaced where they stand, so every producer keeps the bytes it served. */
export function toArrival({ runId: _runId, runDepartureAt: _runDepartureAt, ...call }: StopCall): Arrival {
  return {
    ...call,
    expectedArrivalAt: toServedInstant(call.expectedArrivalAt),
    expectedDepartureAt: toServedInstant(call.expectedDepartureAt),
    scheduledArrivalAt: toServedInstant(call.scheduledArrivalAt),
    scheduledDepartureAt: toServedInstant(call.scheduledDepartureAt),
  };
}
