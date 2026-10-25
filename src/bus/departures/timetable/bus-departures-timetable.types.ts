import type { SequenceStop } from "../../stops/bus-stops.types";

/** WHY: where one route type's sequence places a leg: the board stop's index and the alight stop's after it, if asked for. */
export interface LegStops {
  board: { index: number; action: SequenceStop["action"] };
  alight: { index: number; action: SequenceStop["action"] } | null;
}

export type LegStopsByRouteType = ReadonlyMap<string, LegStops>;
