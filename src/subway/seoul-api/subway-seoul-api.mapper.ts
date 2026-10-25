import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { CountdownRow, SubwayDirection, TrainEvent, TrainNumbering, TrainState } from "../subway.types";
import { isArrivalRowInWindow, toTimetableTrainNo } from "./subway-seoul-api.rules";
import type { SeoulArrivalRow, SeoulPositionRow } from "./subway-seoul-api.schema";
import type { CountdownPlatform, PositionPlatformIds } from "./subway-seoul-api.types";

const RECPTN_DT_FORMAT = "YYYY-MM-DD HH:mm:ss";

// WHY: `3` (left the previous station) names the station a train is heading for, not one it has reached;
// the tracker orders a train by the station a state happened at, which that row does not say.
const STATE_BY_TRAIN_STTUS: Readonly<Record<SeoulPositionRow["trainSttus"], TrainState | null>> = {
  "0": "approaching",
  "1": "arrived",
  "2": "departed",
  "3": null,
};

// QUIRK(seoul-subway-api): a position row's `updnLine` is `0` for an up train and `1` for a down one, but a train
// leaving a terminus keeps its old value for a minute or more while its destination has already turned (2026-10-17).
const DIRECTION_BY_UPDN_LINE: Readonly<Record<SeoulPositionRow["updnLine"], SubwayDirection>> = { "0": "up", "1": "down" };

export function toTrainEvents(
  rows: readonly SeoulPositionRow[],
  { platformIdByStatnId, platformIdByName }: PositionPlatformIds,
  trainNumbers: TrainNumbering,
): TrainEvent[] {
  return rows.flatMap((row) => {
    const platformId = platformIdByStatnId.get(row.statnId) ?? platformIdByName.get(row.statnNm);
    const state = STATE_BY_TRAIN_STTUS[row.trainSttus];
    if (platformId === undefined || state === null) return [];
    const trainNo = toTimetableTrainNo(row.trainNo, trainNumbers, row.statnTnm);
    const reported = trainNumbers === "trainset" ? { reportedDirection: DIRECTION_BY_UPDN_LINE[row.updnLine] } : {};
    return trainNo === null ? [] : [{ trainNo, platformId, state, stateChangedAt: toKstInstant(row.recptnDt), destination: row.statnTnm, ...reported }];
  });
}

// WHY: one call answers every line at the station, each row carrying its line's `statnId` there, so a row counts for
// its own platform alone and is dropped for a line the station does not serve.
export function toCountdownRows(
  rows: readonly SeoulArrivalRow[],
  platformByStatnId: ReadonlyMap<string, CountdownPlatform>,
  fetchedAt: Date,
): CountdownRow[] {
  return rows.flatMap((row) => {
    const platform = platformByStatnId.get(row.statnId);
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
