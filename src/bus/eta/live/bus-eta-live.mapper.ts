import type { ShuttleEtaDoc } from "../bus-eta.document";
import { etaDocId } from "../bus-eta.mapper";
import type { EtaRun, LiveFetch } from "../bus-eta.types";

// WHY: a fixed value is served for 7 days after its run.
const LIVE_LIFE_MS = 8 * 24 * 60 * 60_000;

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
