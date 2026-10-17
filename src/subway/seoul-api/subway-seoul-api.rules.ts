import { captureGroups } from "../../shared/regex.util";
import type { TrainNumbering } from "../subway.types";

// EVIDENCE: on 2026-10-17 21:05–21:24 KST every line 2 and line 3 arrival row was 27–50 s old, while one Suin–Bundang
// row kept its recptnDt for 663 s as its text advanced; older than this, a row is frozen.
const MAX_ARRIVAL_ROW_AGE_MS = 180_000;
// EVIDENCE: the same evening Shinbundang arrival rows were dated 180–276 s ahead of the fetch (123 rows), its clock
// running ahead; a row dated past this is not a reading of now.
const MAX_ARRIVAL_ROW_AHEAD_MS = 30_000;

const OPERATOR_LETTERED_NO = /^[A-Z]?(\d{1,4})[A-Z]?$/;
const TRAINSET_NO = /^\d{1,4}$/;
const TRAIN_NO_DIGITS = 4;
// EVIDENCE: at 21:07 KST on 2026-10-17, 16 of 33 line 2 position rows led with another digit than the timetable's `2`
// (`3361` for `2361`), the last three digits and parity alike; branch trains led with `1` or `5`, and `9` marks a
// temporary branch train in DarkTornado/subway's topis.py.
const MAIN_LINE_CIRCLE_NO = /^[02-46-8](\d{3})$/;
const CIRCLE_TRAIN_NO_PREFIX = "2";
const BRANCH_DESTINATIONS: ReadonlySet<string> = new Set(["성수지선", "신도림지선"]);

export function isArrivalRowInWindow(generatedAt: Date, fetchedAt: Date): boolean {
  const aheadMs = generatedAt.getTime() - fetchedAt.getTime();
  return aheadMs <= MAX_ARRIVAL_ROW_AHEAD_MS && -aheadMs <= MAX_ARRIVAL_ROW_AGE_MS;
}

export function toTimetableTrainNo(raw: string, numbering: TrainNumbering, destination?: string): string | null {
  if (numbering === "circle") return toCircleTrainNo(raw, destination);
  if (numbering === "trainset") return TRAINSET_NO.test(raw) ? raw : null;
  const groups = captureGroups(raw, OPERATOR_LETTERED_NO, 1);
  return groups ? groups[0].padStart(TRAIN_NO_DIGITS, "0") : null;
}

function toCircleTrainNo(raw: string, destination: string | undefined): string | null {
  const groups = captureGroups(raw, MAIN_LINE_CIRCLE_NO, 1);
  const isBranchDestination = destination !== undefined && BRANCH_DESTINATIONS.has(destination);
  return groups && !isBranchDestination ? `${CIRCLE_TRAIN_NO_PREFIX}${groups[0]}` : null;
}
