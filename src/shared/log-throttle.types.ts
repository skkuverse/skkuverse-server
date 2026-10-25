/**
 * WHY: a condition that recurs on every request (a database that stays down) would otherwise write one
 * warning per request and flood the log. `suppressed` counts the lines skipped since.
 */
export interface LogThrottle {
  take(key: string): { suppressed: number } | null;
}
