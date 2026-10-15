import type { EtaKind } from "./bus-eta.document";
import type { RunKey } from "./bus-eta.types";

export function etaDocId(run: RunKey, kind: EtaKind): string {
  return `${run.serviceId}|${run.routeType}|${run.date}|${run.time}|${kind}`;
}
