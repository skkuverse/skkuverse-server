import type { EtaTravel, ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import type { EtaRun } from "../bus-eta.types";

interface LiveFetch {
  offsetsSec: number[];
  fetchedAt: Date;
  /** WHY: set when the value is fixed for good. */
  frozenAt?: Date;
  travel?: EtaTravel;
}

// WHY: a fixed value is served for 7 days after its run, and a week later a bus-lane run's prediction reuses it.
const LIVE_LIFE_MS = 8 * 24 * 60 * 60_000;

export function liveDoc(run: EtaRun, { offsetsSec, fetchedAt, frozenAt, travel }: LiveFetch): ShuttleEtaDoc {
  return {
    _id: etaDocId(run, "live"),
    kind: "live",
    serviceId: run.serviceId,
    routeType: run.routeType,
    date: run.date,
    time: run.time,
    departAt: run.departAt,
    offsetsSec,
    source: "naver",
    fetchedAt,
    ...(frozenAt ? { frozen: true as const, frozenAt } : {}),
    ...(travel ? { travel } : {}),
    expiresAt: new Date(run.departAt.getTime() + LIVE_LIFE_MS),
  };
}
