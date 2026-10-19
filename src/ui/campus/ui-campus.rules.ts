import { isBrokenLinkAction } from "../../shared/link-action.util";
import { toMiniAppTargetReferences } from "../ui.rules";
import type { MiniAppReference, MiniAppRegistry, TargetGrammar } from "../ui.types";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusBannerIssue } from "./ui-campus.types";

export function toCampusBannerIssues(banners: CampusBannerCarouselRaw, registry: MiniAppRegistry): CampusBannerIssue[] {
  return banners.items.flatMap((image, index) => {
    if (!isBrokenLinkAction(image, registry)) return [];
    const message = `"${image.id}" actionValue "${image.actionValue}" is not valid for "${image.actionType}"`;
    return [{ path: ["items", index, "actionValue"], message }];
  });
}

export function campusBannerReferences(banners: CampusBannerCarouselRaw, grammar: TargetGrammar): MiniAppReference[] {
  return banners.items.flatMap((image, index) => toMiniAppTargetReferences(image, ["items", index, "actionValue"], grammar));
}

function toUnresolvedIndex({ path }: CampusBannerIssue): number {
  const [list, index] = path;
  if (list !== "items" || typeof index !== "number") throw new Error(`campus banner issue path ${path.join(".")} names no banner`);
  return index;
}

export function withoutUnresolvedBanners(banners: CampusBannerCarouselRaw, issues: readonly CampusBannerIssue[]): CampusBannerCarouselRaw {
  const unresolved = new Set(issues.map(toUnresolvedIndex));
  return { ...banners, items: banners.items.filter((_, index) => !unresolved.has(index)) };
}
