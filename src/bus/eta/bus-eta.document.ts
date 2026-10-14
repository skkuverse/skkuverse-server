export type EtaKind = "baseline" | "live";

/** WHY: `shuttle_eta`, one document per run and source, written only by the estimate pollers. */
export interface ShuttleEtaDoc {
  /** WHY: `${serviceId}|${routeType}|${date}|${time}|${kind}`. */
  _id: string;
  kind: EtaKind;
  serviceId: string;
  routeType: string;
  date: string;
  time: string;
  departAt: Date;
  /** WHY: cumulative seconds from the first stop, one per sequence stop, so one document serves every bus that leaves then. */
  offsetsSec: number[];
  source: "naver" | "tmap";
  fetchedAt: Date;
  frozen?: true;
  frozenAt?: Date;
  expiresAt: Date;
}
