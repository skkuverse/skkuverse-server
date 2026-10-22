import { toServedWebviewUrl, toWebviewUrl } from "../infra/webview-url";
import type { LinkPolicy, LinkProblem } from "./link-action.types";
import type { LinkActionType } from "./link-action.wire";
import { isAbsoluteHttpsUrl, isRootRelativePath } from "./link-target.util";

const WHITESPACE_RE = /\s/;

type LinkAction = { actionType?: LinkActionType; actionValue?: string };

const OWN_ORIGIN_LINKS = { webview: "own-origin", isAllowedRoute: isRootRelativePath } as const;

function isAllowedLinkTarget(actionType: LinkActionType, actionValue: string, policy: LinkPolicy): boolean {
  switch (actionType) {
    case "miniapp":
      return policy.isKnownMiniAppTarget(actionValue);
    case "external":
      return isAbsoluteHttpsUrl(actionValue);
    case "webview":
      return policy.webview === "own-origin" ? toWebviewUrl(actionValue) !== null : isAbsoluteHttpsUrl(actionValue);
    case "route":
      return policy.isAllowedRoute(actionValue);
    default: {
      const unknownType: never = actionType;
      throw new Error(`unknown link actionType "${String(unknownType)}"`);
    }
  }
}

function problemOf(actionType: LinkActionType, policy: LinkPolicy): LinkProblem {
  if (actionType === "miniapp") return "unknown-miniapp-target";
  if (actionType === "route") return "route-not-allowed";
  return actionType === "webview" && policy.webview === "own-origin" ? "not-webview-url" : "not-https-url";
}

// WHY: whitespace is refused before the policy, so no policy can accept a value a parser would trim.
export function toLinkProblem(actionType: LinkActionType, actionValue: string, policy: LinkPolicy): LinkProblem | null {
  const isBlank = actionValue === "" || WHITESPACE_RE.test(actionValue);
  return isBlank || !isAllowedLinkTarget(actionType, actionValue, policy) ? problemOf(actionType, policy) : null;
}

// WHY: an absent action is not broken: an item may carry no link at all.
export function isBrokenLinkAction(
  { actionType, actionValue }: LinkAction,
  registry: { isKnownMiniAppTarget(value: string): boolean },
): boolean {
  if (actionType === undefined || actionValue === undefined) return false;
  const policy: LinkPolicy = { ...OWN_ORIGIN_LINKS, isKnownMiniAppTarget: (value) => registry.isKnownMiniAppTarget(value) };
  return toLinkProblem(actionType, actionValue, policy) !== null;
}

// WHY: a root-relative `webview` value is served absolute, so the app opens a complete URL.
export function toServedActionValue(actionType: LinkActionType, actionValue: string): string {
  return actionType === "webview" ? toServedWebviewUrl(actionValue) : actionValue;
}
