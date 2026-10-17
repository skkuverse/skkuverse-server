import { toServedWebviewUrl, toWebviewUrl } from "../infra/webview-url";
import type { LinkActionType } from "./link-action.wire";
import { isAbsoluteHttpsUrl, isRootRelativePath } from "./link-target.util";

const WHITESPACE_RE = /\s/;

type LinkAction = { actionType?: LinkActionType; actionValue?: string };

// WHY: an absent action is not broken: an item may carry no link at all.
export function isBrokenLinkAction(
  { actionType, actionValue }: LinkAction,
  registry: { isKnownMiniAppTarget(value: string): boolean },
): boolean {
  if (actionType === undefined || actionValue === undefined) return false;
  if (actionValue === "" || WHITESPACE_RE.test(actionValue)) return true;
  switch (actionType) {
    case "miniapp":
      return !registry.isKnownMiniAppTarget(actionValue);
    case "external":
      return !isAbsoluteHttpsUrl(actionValue);
    case "webview":
      return toWebviewUrl(actionValue) === null;
    case "route":
      return !isRootRelativePath(actionValue);
    default: {
      const unknownType: never = actionType;
      throw new Error(`unknown link actionType "${String(unknownType)}"`);
    }
  }
}

// WHY: a root-relative `webview` value is served absolute, so the app opens a complete URL.
export function toServedActionValue(actionType: LinkActionType, actionValue: string): string {
  return actionType === "webview" ? toServedWebviewUrl(actionValue) : actionValue;
}
