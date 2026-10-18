import { MAX_EMPTY_CRAWL_GAP_MS, MAX_EMPTY_LINE_MS, MIN_BRANCH_DIRECTION_DIGIT } from "./subway-seoul-trainmap.constants";
import type { EmptySpell } from "./subway-seoul-trainmap.types";

export function toEmptySpell(previous: EmptySpell | undefined, observedAt: Date): EmptySpell {
  const isContinued = previous !== undefined && observedAt.getTime() - previous.lastAt.getTime() <= MAX_EMPTY_CRAWL_GAP_MS;
  return { since: isContinued ? previous.since : observedAt, lastAt: observedAt };
}

export function isEmptyTooLong(spell: EmptySpell): boolean {
  return spell.lastAt.getTime() - spell.since.getTime() > MAX_EMPTY_LINE_MS;
}

// WHY: a branch train runs off the circle, and the map numbers it `26xx`, a number no circle trip of the timetable keeps.
export function isBranchTrain(directionDigit: string): boolean {
  return Number(directionDigit) >= MIN_BRANCH_DIRECTION_DIGIT;
}
