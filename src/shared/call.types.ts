import type { Call } from "./call.wire";

export type CallInstantKey = "expectedArrivalAt" | "expectedDepartureAt" | "scheduledArrivalAt" | "scheduledDepartureAt";

/** WHY: the wire call field for field with Date instants, which only toCall formats, so no producer re-parses a served time. */
export type StopCall = Omit<Call, CallInstantKey> & Record<CallInstantKey, Date | null>;

/** WHY: a timetabled run at one stop: the time shown there, the timetable's own, and whether the shown one is an estimate. */
export interface TimetabledStopTime {
  shownAt: Date | null;
  timetableAt: Date | null;
  isEstimated: boolean;
}

/** WHY: riders board at a boarding stop and get off at an alighting one, so a call there carries the departure or the arrival pair. */
export type CallSide = "board" | "alight";

export type RunIdentity = Pick<StopCall, "runId" | "headsign" | "isFirstRun" | "isLastRun">;
