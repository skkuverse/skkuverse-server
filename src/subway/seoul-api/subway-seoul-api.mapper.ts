import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { CountdownRow, TrainEvent, TrainNumbering, TrainState } from "../subway.types";
import { isArrivalRowInWindow, toTimetableTrainNo } from "./subway-seoul-api.rules";
import type { SeoulArrivalRow, SeoulPositionRow } from "./subway-seoul-api.schema";
import type { CountdownPlatform } from "./subway-seoul-api.types";

const RECPTN_DT_FORMAT = "YYYY-MM-DD HH:mm:ss";

// WHY: `3` (left the previous station) names the station a train is heading for, not one it has reached;
// the tracker orders a train by the station a state happened at, which that row does not say.
const STATE_BY_TRAIN_STTUS: Readonly<Record<SeoulPositionRow["trainSttus"], TrainState | null>> = {
  "0": "approaching",
  "1": "arrived",
  "2": "departed",
  "3": null,
};

export function toTrainEvents(
  rows: readonly SeoulPositionRow[],
  platformIdByName: ReadonlyMap<string, string>,
  trainNumbers: TrainNumbering,
): TrainEvent[] {
  return rows.flatMap((row) => {
    const platformId = platformIdByName.get(row.statnNm);
    const state = STATE_BY_TRAIN_STTUS[row.trainSttus];
    if (platformId === undefined || state === null) return [];
    const trainNo = toTimetableTrainNo(row.trainNo, trainNumbers, row.statnTnm);
    return trainNo === null ? [] : [{ trainNo, platformId, state, stateChangedAt: toKstInstant(row.recptnDt), destination: row.statnTnm }];
  });
}

// WHY: one call answers every line at the station, told apart only by `subwayId`, so a row counts for its own line's
// platform alone and is dropped for a line the station does not serve.
export function toCountdownRows(
  rows: readonly SeoulArrivalRow[],
  platformBySubwayId: ReadonlyMap<string, CountdownPlatform>,
  fetchedAt: Date,
): CountdownRow[] {
  return rows.flatMap((row) => {
    const platform = platformBySubwayId.get(row.subwayId);
    const remainingSec = Number(row.barvlDt);
    const generatedAt = toKstInstant(row.recptnDt);
    if (platform === undefined || remainingSec === 0 || !isArrivalRowInWindow(generatedAt, fetchedAt)) return [];
    const trainNo = toTimetableTrainNo(row.btrainNo, platform.trainNumbers);
    return trainNo === null ? [] : [{ trainNo, platformId: platform.platformId, generatedAt, remainingSec }];
  });
}

function toKstInstant(recptnDt: string): Date {
  return moment.tz(recptnDt, RECPTN_DT_FORMAT, true, KST_TIME_ZONE).toDate();
}
