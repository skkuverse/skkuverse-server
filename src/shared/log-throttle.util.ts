import type { LogThrottle } from "./log-throttle.types";

// WHY: keys are config-sized, never per user, so this is a backstop, not a cache size.
const MAX_KEYS = 1000;

export function createLogThrottle(intervalMs: number, now: () => number = Date.now): LogThrottle {
  const state = new Map<string, { lastAt: number; suppressed: number }>();
  return {
    take(key) {
      const takenAt = now();
      const entry = state.get(key);
      if (entry && takenAt - entry.lastAt < intervalMs) {
        entry.suppressed += 1;
        return null;
      }
      const suppressed = entry?.suppressed ?? 0;
      if (!entry && state.size >= MAX_KEYS) {
        const oldest = state.keys().next().value;
        if (oldest !== undefined) state.delete(oldest);
      }
      state.set(key, { lastAt: takenAt, suppressed: 0 });
      return { suppressed };
    },
  };
}
