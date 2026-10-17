import type { TrainEvent, TrainState } from "../subway.types";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import type { TrainMapStatus, TrainMapTrain } from "./subway-seoul-trainmap.types";

const UNEXPECTED_SHAPE = "unexpected_shape";
const OK_STATUS = 200;
const LINE_BLOCK_START = /<div class="(\d+)line_(?:metro|korail)">/g;
// QUIRK(seoul-trainmap): the page's own script takes every `div` whose class starts with `T` for a train.
const TRAIN_DIV = /<div class="(T[^"]*)"\s+title="([^"]*)"/g;
const TRAIN_CLASS = /^T\d{4}_[YN]_[12]_/;
const TRAIN_TITLE = /^[A-Z]?(\d{4})열차\s+(.+?)\s+(진입|접근|도착|출발|이동)\s+(.+)행$/;

// EVIDENCE: on the 2026-10-16 20:45 page, each "moving" train was at the station before the one named, by
// the API at the same moment; each "nearing" train was nearing or at the named station by the API.
const STATE_BY_STATUS: Readonly<Record<TrainMapStatus, TrainState | null>> = {
  진입: "approaching",
  접근: "approaching",
  도착: "arrived",
  출발: "departed",
  이동: null,
};

export function toTrainMapTrains(page: string, line: string): TrainMapTrain[] {
  const blocks = toLineBlocks(page, line);
  if (blocks.length === 0) throw shapeError(`line ${line}: no line block`);
  const trains = blocks.flatMap((block) => [...block.matchAll(TRAIN_DIV)].map(([, trainClass = "", title = ""]) => toTrain(line, trainClass, title)));
  return trains;
}

export function toTrainEvents(trains: readonly TrainMapTrain[], stationIdByName: ReadonlyMap<string, string>, observedAt: Date): TrainEvent[] {
  return trains.flatMap((train) => {
    const stationId = stationIdByName.get(train.stationName);
    const state = STATE_BY_STATUS[train.status];
    if (stationId === undefined || state === null) return [];
    return [{ trainNo: train.trainNo, stationId, state, stateChangedAt: observedAt, destination: train.destination }];
  });
}

function toLineBlocks(page: string, line: string): string[] {
  const starts = [...page.matchAll(LINE_BLOCK_START)];
  return starts.flatMap((start, i) => (start[1] === line ? [page.slice(start.index, starts[i + 1]?.index ?? page.length)] : []));
}

function toTrain(line: string, trainClass: string, title: string): TrainMapTrain {
  const parsed = TRAIN_TITLE.exec(title);
  if (!TRAIN_CLASS.test(trainClass) || !parsed) throw shapeError(`line ${line}: a train div of another shape`);
  const [, trainNo = "", stationName = "", status = "", destination = ""] = parsed;
  return { trainNo, stationName, status: status as TrainMapStatus, destination };
}

function shapeError(detail: string): SubwaySeoulTrainmapError {
  return new SubwaySeoulTrainmapError(detail, OK_STATUS, UNEXPECTED_SHAPE);
}
