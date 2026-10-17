import type { LatLng } from "../../../shared/lat-lng.types";
import type { LaneDirection } from "../lane/bus-eta-lane.types";
import type { BusLaneSpanDoc } from "./bus-eta-probe.document";

/** WHY: one bus of a TOPIS snapshot; `dataTm` is when its GPS fix was taken, about a minute before the fetch. */
export interface LanePosition extends LatLng { vehId: string; sectOrd: number; dataTm: Date }

export type CorridorFix = LanePosition & { alongM: number; direction: LaneDirection };

export type LaneSpan = Omit<BusLaneSpanDoc, "_id" | "expiresAt">;

/** WHY: "noSpans" when no counted span reaches the leg (no partner snapshot yet), "lowCoverage" under the threshold. */
export type LegTime =
  | { kind: "probe"; corridorSec: number; spanCount: number; coverage: number }
  | { kind: "unavailable"; reason: "noSpans" | "lowCoverage"; spanCount: number; coverage: number };
