import type { EtaKind, ShuttleEtaDoc } from "./bus-eta.document";
import type { EtaRun, LiveFetch, RunKey } from "./bus-eta.types";

// QUIRK(tmap): its terms forbid using a forecast 24 hours after storing it.
const BASELINE_LIFE_MS = 24 * 60 * 60_000;
// WHY: a fixed value is served for 7 days after its run.
const LIVE_LIFE_MS = 8 * 24 * 60 * 60_000;

export function etaDocId(run: RunKey, kind: EtaKind): string {
  return `${run.serviceId}|${run.routeType}|${run.date}|${run.time}|${kind}`;
}

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

export function liveDoc(run: EtaRun, { offsetsSec, fetchedAt, frozenAt }: LiveFetch): ShuttleEtaDoc {
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
    expiresAt: new Date(run.departAt.getTime() + LIVE_LIFE_MS),
  };
}
