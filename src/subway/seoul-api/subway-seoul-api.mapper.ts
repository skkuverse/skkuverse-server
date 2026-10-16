import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../../shared/time-zone.constants";
import type { CountdownRow, TrainEvent, TrainState } from "../subway.types";
import type { SeoulArrivalRow, SeoulPositionRow } from "./subway-seoul-api.schema";

const RECPTN_DT_FORMAT = "YYYY-MM-DD HH:mm:ss";

// WHY: `3` (left the previous station) names the station a train is heading for, not one it has reached;
// the tracker orders a train by the station a state happened at, which that row does not say.
const STATE_BY_TRAIN_STTUS: Readonly<Record<SeoulPositionRow["trainSttus"], TrainState | null>> = {
  "0": "approaching",
  "1": "arrived",
  "2": "departed",
  "3": null,
};

export function toTrainEvents(rows: readonly SeoulPositionRow[], stationIdByName: ReadonlyMap<string, string>): TrainEvent[] {
  return rows.flatMap((row) => {
    const stationId = stationIdByName.get(row.statnNm);
    const state = STATE_BY_TRAIN_STTUS[row.trainSttus];
    if (stationId === undefined || state === null) return [];
    return [{ trainNo: row.trainNo, stationId, state, stateChangedAt: toKstInstant(row.recptnDt), destination: row.statnTnm }];
  });
}

export function toCountdownRows(rows: readonly SeoulArrivalRow[], stationIdByName: ReadonlyMap<string, string>): CountdownRow[] {
  return rows.flatMap((row) => {
    const stationId = stationIdByName.get(row.statnNm);
    const remainingSec = Number(row.barvlDt);
    if (stationId === undefined || remainingSec === 0) return [];
    return [{ trainNo: row.btrainNo, stationId, generatedAt: toKstInstant(row.recptnDt), remainingSec }];
  });
}

function toKstInstant(recptnDt: string): Date {
  return moment.tz(recptnDt, RECPTN_DT_FORMAT, true, KST_TIME_ZONE).toDate();
}
