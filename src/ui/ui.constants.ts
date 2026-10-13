// WHY: static config resolved per request, so it may be cached like the mini-app registry it references;
// five minutes also bounds how late a banner's `endAt` takes effect.
export const UI_CACHE_CONTROL = "public, max-age=300";

export const MIN_ASPECT_RATIO = 1;
export const MAX_ASPECT_RATIO = 6;
export const MIN_AUTO_ROTATE_SEC = 2;
export const MAX_AUTO_ROTATE_SEC = 30;

export const LOST_AND_FOUND_PATH = "/skku/lostandfound";
export const LOST_AND_FOUND_COLOR = "003626";

// WHY: here with its limits, not in ui.rules.ts: ui.schema.ts refines with it, and ui.rules.ts imports ui.schema.ts.
export function isAutoRotateSec(sec: number): boolean {
  return sec === 0 || (sec >= MIN_AUTO_ROTATE_SEC && sec <= MAX_AUTO_ROTATE_SEC);
}
