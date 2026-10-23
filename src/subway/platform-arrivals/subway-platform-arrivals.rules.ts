import { MAX_STATE_AGE_MS } from "./subway-platform-arrivals.constants";

export function isFreshState(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= MAX_STATE_AGE_MS;
}
