import type { FactsRow, RowTokenTone } from "../row/notices-row.types";

// WHY: the tones whose word a bare date line leaves unsaid; "urgent", "today" and "closed" already read in line 2.
export const SPOKEN_TONES: ReadonlySet<RowTokenTone> = new Set(["cancelled", "stopped", "postponed", "extended", "changed"]);

// WHY: a notice a statement stopped, or whose date the row will not state, has no deadline to count down to.
export const DATELESS_STATUSES: ReadonlySet<FactsRow["status"]> = new Set(["cancelled", "suspended", "postponed", "abstain", "nodate"]);

export const ONE_LINER_SEPARATOR = " · ";
