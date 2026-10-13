import type { LinkActionType } from "../shared/link-action.wire";
import { isAbsoluteHttpsUrl, isRootRelativePath } from "../shared/link-target.util";
import { webviewUrl, type BannerImageRaw } from "./ui.schema";
import type { MiniAppRegistry } from "./ui.types";

const WHITESPACE_RE = /\s/;

type LinkAction = { actionType?: LinkActionType; actionValue?: string };

export function isBannerShowing(image: Pick<BannerImageRaw, "startAt" | "endAt">, now: Date): boolean {
  const at = now.getTime();
  if (image.startAt !== undefined && at < Date.parse(image.startAt)) return false;
  return image.endAt === undefined || at < Date.parse(image.endAt);
}

export function findRepeatedId<T extends { id: string }>(items: readonly T[]): T | undefined {
  return items.find((item, index) => items.findIndex((other) => other.id === item.id) !== index);
}

// WHY: each type is checked as the event map checks its sheet buttons (`isValidActionValue`), so a link
// valid in one is valid in the other; unlike the map, an absent action is not broken and there is no `content`.
export function isBrokenLinkAction({ actionType, actionValue }: LinkAction, registry: MiniAppRegistry): boolean {
  if (actionType === undefined || actionValue === undefined) return false;
  if (actionValue === "" || WHITESPACE_RE.test(actionValue)) return true;
  switch (actionType) {
    case "miniapp":
      return !registry.isKnownMiniAppTarget(actionValue);
    case "external":
      return !isAbsoluteHttpsUrl(actionValue);
    case "webview":
      return !webviewUrl.safeParse(actionValue).success;
    case "route":
      return !isRootRelativePath(actionValue);
    default: {
      const unknownType: never = actionType;
      throw new Error(`unknown link actionType "${String(unknownType)}"`);
    }
  }
}
