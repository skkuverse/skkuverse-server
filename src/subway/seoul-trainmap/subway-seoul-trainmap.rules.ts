import { MAX_EMPTY_CRAWL_GAP_MS, MAX_EMPTY_LINE_MS } from "./subway-seoul-trainmap.constants";
import type { EmptySpell } from "./subway-seoul-trainmap.types";

export function toEmptySpell(previous: EmptySpell | undefined, observedAt: Date): EmptySpell {
  const isContinued = previous !== undefined && observedAt.getTime() - previous.lastAt.getTime() <= MAX_EMPTY_CRAWL_GAP_MS;
  return { since: isContinued ? previous.since : observedAt, lastAt: observedAt };
}

export function isEmptyTooLong(spell: EmptySpell): boolean {
  return spell.lastAt.getTime() - spell.since.getTime() > MAX_EMPTY_LINE_MS;
}
