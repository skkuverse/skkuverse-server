import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import type { EtaRun } from "../bus-eta.types";

// QUIRK(tmap): its terms forbid using a forecast 24 hours after storing it.
const BASELINE_LIFE_MS = 24 * 60 * 60_000;

export function baselineDoc(run: EtaRun, offsetsSec: number[], fetchedAt: Date): ShuttleEtaDoc {
  return {
    _id: etaDocId(run, "baseline"),
    kind: "baseline",
    serviceId: run.serviceId,
    routeType: run.routeType,
    date: run.date,
    time: run.time,
    departAt: run.departAt,
    offsetsSec,
    source: "tmap",
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + BASELINE_LIFE_MS),
  };
}
