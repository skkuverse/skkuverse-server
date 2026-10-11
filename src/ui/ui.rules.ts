import type { BannerImageRaw } from "./ui.schema";

export const MIN_ASPECT_RATIO = 1;
export const MAX_ASPECT_RATIO = 6;
export const MIN_AUTO_ROTATE_SEC = 2;
export const MAX_AUTO_ROTATE_SEC = 30;

export function isAutoRotateSec(sec: number): boolean {
  return sec === 0 || (sec >= MIN_AUTO_ROTATE_SEC && sec <= MAX_AUTO_ROTATE_SEC);
}

export function isBannerShowing(image: Pick<BannerImageRaw, "startAt" | "endAt">, now: Date): boolean {
  const at = now.getTime();
  if (image.startAt !== undefined && at < Date.parse(image.startAt)) return false;
  return image.endAt === undefined || at < Date.parse(image.endAt);
}

export function findDuplicateId(ids: readonly string[]): string | undefined {
  return ids.find((id, index) => ids.indexOf(id) !== index);
}
