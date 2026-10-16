import { MAX_STATE_AGE_MS } from "./subway-arrivals.constants";

const SECOND_MS = 1000;

export function isFreshState(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() <= MAX_STATE_AGE_MS;
}

export function toRemainingSec(arrivalAt: Date, generatedAt: Date): number {
  return Math.max(0, Math.round((arrivalAt.getTime() - generatedAt.getTime()) / SECOND_MS));
}
