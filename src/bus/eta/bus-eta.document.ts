export type EtaKind = "baseline" | "live";

/** WHY: how a bus-lane run's live value was timed, kept to check the model and never served; `car` means it fell back. */
export type EtaTravel =
  | { model: "car" }
  | { model: "busLane"; corridorCarSec: number; corridorSec: number; spanCount: number; coverage: number };

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
  /** WHY: set only on a bus-lane run's live value; a car run, and any document written before it, has none. */
  travel?: EtaTravel;
  /** WHY: set only on a prediction that reuses a fixed value: that value's `_id`. */
  derivedFrom?: string;
  expiresAt: Date;
}

/** WHY: a fixed live value as a bus-lane run's prediction reuses it. */
export type FixedEstimate = Pick<ShuttleEtaDoc, "_id" | "serviceId" | "routeType" | "date" | "time" | "offsetsSec">;
