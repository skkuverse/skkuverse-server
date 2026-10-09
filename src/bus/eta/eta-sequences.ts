/**
 * The stop sequences the estimate pollers work on: every route type that
 * `service-config.ts` opts in (`eta.routeTypes`), with its stops' coordinates
 * in order — what a directions call is sent.
 */
import serviceConfig from "../schedule/service-config";
import { etaOptIns, stopCatalog } from "../schedule/schedule-stops";
import type { LatLng, ScheduleStopCatalog } from "../types";

export interface EtaSequence {
  serviceId: string;
  routeType: string;
  stops: LatLng[];
}

export function etaSequences(
  catalog: Readonly<ScheduleStopCatalog> = stopCatalog,
  optIns: ReadonlyMap<string, readonly string[]> = etaOptIns(serviceConfig),
): EtaSequence[] {
  const coords = new Map(catalog.stops.map((s) => [s.id, s.coords]));
  const out: EtaSequence[] = [];
  for (const [serviceId, routeTypes] of optIns) {
    for (const routeType of routeTypes) {
      // The catalog loader refused an opted-in sequence that is missing, holds
      // a label stop, or has a stop without coordinates (etaErrors).
      const stops = catalog.sequences[serviceId]![routeType]!.map((st) => coords.get(st.stopId!)!);
      out.push({ serviceId, routeType, stops });
    }
  }
  return out;
}

/** `(serviceId, routeType)` → its stop count, for `writeEtas`. */
export function sequenceLengths(sequences: readonly EtaSequence[]) {
  const lengths = new Map(sequences.map((s) => [`${s.serviceId}|${s.routeType}`, s.stops.length]));
  return (serviceId: string, routeType: string): number | undefined => lengths.get(`${serviceId}|${routeType}`);
}
