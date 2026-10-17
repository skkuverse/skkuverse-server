import type { TrainEvent, TrainState } from "../subway.types";
import { DEFAULT_TRAIN_CLASS, TRAIN_CLASS_BY_LINE } from "./subway-seoul-trainmap.constants";
import { SubwaySeoulTrainmapError } from "./subway-seoul-trainmap.error";
import { isBranchTrain } from "./subway-seoul-trainmap.rules";
import type { TrainMapStatus, TrainMapTrain } from "./subway-seoul-trainmap.types";

const UNEXPECTED_SHAPE = "unexpected_shape";
const OK_STATUS = 200;
const LINE_BLOCK_START = /<div class="(\d+)line_(?:metro|korail)">/g;
// QUIRK(seoul-trainmap): the page's own script takes every `div` whose class starts with `T` for a train.
const TRAIN_DIV = /<div class="(T[^"]*)"\s+title="([^"]*)"/g;
const TRAIN_TITLE = /^[A-Z]?(\d{4})열차\s+(.+?)\s+(진입|접근|도착|출발|이동)\s+(?:(.+)행|(내선순환|외선순환))$/;

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
  return blocks.flatMap((block) => [...block.matchAll(TRAIN_DIV)].flatMap(([, trainClass = "", title = ""]) => toTrain(line, trainClass, title) ?? []));
}

export function toTrainEvents(trains: readonly TrainMapTrain[], platformIdByName: ReadonlyMap<string, string>, observedAt: Date): TrainEvent[] {
  return trains.flatMap((train) => {
    const platformId = platformIdByName.get(train.stationName);
    const state = STATE_BY_STATUS[train.status];
    if (platformId === undefined || state === null) return [];
    return [{ trainNo: train.trainNo, platformId, state, stateChangedAt: observedAt, destination: train.destination }];
  });
}

function toLineBlocks(page: string, line: string): string[] {
  const starts = [...page.matchAll(LINE_BLOCK_START)];
  return starts.flatMap((start, i) => (start[1] === line ? [page.slice(start.index, starts[i + 1]?.index ?? page.length)] : []));
}

function toTrain(line: string, trainClass: string, title: string): TrainMapTrain | null {
  const directionDigit = (TRAIN_CLASS_BY_LINE.get(line) ?? DEFAULT_TRAIN_CLASS).exec(trainClass)?.[1];
  const train = toTrainMapTrain(title);
  if (directionDigit === undefined || !train) throw shapeError(`line ${line}: a train div of another shape`);
  return isBranchTrain(directionDigit) ? null : train;
}

function toTrainMapTrain(title: string): TrainMapTrain | null {
  const parsed = TRAIN_TITLE.exec(title);
  if (!parsed) return null;
  const [, trainNo = "", stationName = "", status = "", terminus, circleDirection = ""] = parsed;
  return { trainNo, stationName, status: status as TrainMapStatus, destination: terminus ?? circleDirection };
}

function shapeError(detail: string): SubwaySeoulTrainmapError {
  return new SubwaySeoulTrainmapError(detail, OK_STATUS, UNEXPECTED_SHAPE);
}
