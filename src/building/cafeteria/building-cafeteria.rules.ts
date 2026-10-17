/** EVIDENCE: sisulList listed 11 cafeterias on 2026-10-17 (4 hssc, 7 nsc); fewer than 8 reads as a short answer. */
export const MIN_CAFETERIAS_FOR_STALE_DELETE = 8;

export function shouldDeleteStaleCafeterias(listedCount: number): boolean {
  return listedCount >= MIN_CAFETERIAS_FOR_STALE_DELETE;
}
