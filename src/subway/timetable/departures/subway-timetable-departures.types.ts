import type { ScheduledStop, ScheduledTrain } from "../subway-timetable.types";

/** WHY: a train that serves a ride, its stop at the board platform and its stop at the alight one, null when no table places it there. */
export interface LegTrain {
  train: ScheduledTrain;
  boardStop: ScheduledStop;
  alightStop: ScheduledStop | null;
}

/** WHY: a dataset's ride on a subway line, as the push checks it against the stored tables. */
export interface SubwayRide {
  lineId: string;
  boardPlatformId: string;
  alightPlatformId: string;
}
