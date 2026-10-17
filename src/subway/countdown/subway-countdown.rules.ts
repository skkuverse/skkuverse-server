import type { CountdownRow } from "../subway.types";

const SECOND_MS = 1000;

const isSameCountdown = (known: CountdownRow, row: CountdownRow): boolean =>
  known.trainNo === row.trainNo && known.stationId === row.stationId && known.remainingSec === row.remainingSec;

// EVIDENCE: Hyehwa's rows of 2026-10-09 repeat each countdown (240, 150, 120 s) for one to three minutes while
// their generation time advances; read from it, an arrival drifted up to 125 s late (kroad0129/metro, paceTable).
export function toFirstPublishedRows(previous: readonly CountdownRow[], rows: readonly CountdownRow[]): CountdownRow[] {
  return rows.map((row) => {
    const first = previous.find((known) => isSameCountdown(known, row) && known.generatedAt < row.generatedAt);
    return first ? { ...row, generatedAt: first.generatedAt } : row;
  });
}

export function toCountingRows(rows: readonly CountdownRow[], now: Date): CountdownRow[] {
  return rows.filter((row) => row.generatedAt.getTime() + row.remainingSec * SECOND_MS > now.getTime());
}
