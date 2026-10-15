import { pick } from "../infra/i18n";
import type { I18n, SupportedLang } from "../infra/types";
import { toServedWebviewUrl } from "../infra/webview-url";
import type { LinkActionType } from "../shared/link-action.wire";
import { isBannerShowing } from "./ui.rules";
import type { BannerImageRaw } from "./ui.schema";
import type { BannerCarousel } from "./ui.wire";

type BannerItem = BannerCarousel["items"][number];

interface BannerCarouselRaw extends Omit<BannerCarousel, "items"> {
  items: ReadonlyArray<BannerImageRaw | { type: "default" }>;
}

// WHY: `ko` is required and non-blank (`localizedText` in ui.schema.ts), so the fallback only satisfies the type.
export function toLocalizedText(text: I18n, lang: SupportedLang): string {
  return pick(text, lang) ?? text.ko;
}

// WHY: a root-relative `webview` value is served absolute, as the event map serves its buttons, so the app opens a complete URL.
export function toServedActionValue(actionType: LinkActionType, actionValue: string): string {
  return actionType === "webview" ? toServedWebviewUrl(actionValue) : actionValue;
}

// WHY: built from named fields rather than `...image`, so the window and the untranslated text never reach the wire.
function toBannerImage(image: BannerImageRaw, lang: SupportedLang): BannerItem {
  const { actionType, actionValue } = image;
  const action = actionType === undefined || actionValue === undefined ? {} : { actionType, actionValue: toServedActionValue(actionType, actionValue) };
  return { type: "image", id: image.id, imageUrl: image.imageUrl, alt: toLocalizedText(image.alt, lang), ...action };
}

export function toBannerCarousel(carousel: BannerCarouselRaw, lang: SupportedLang, now: Date): BannerCarousel {
  const items = carousel.items.flatMap((item): BannerItem[] => {
    if (item.type === "default") return [{ type: "default" }];
    return isBannerShowing(item, now) ? [toBannerImage(item, lang)] : [];
  });
  return {
    type: "banner_carousel",
    id: carousel.id,
    aspectRatio: carousel.aspectRatio,
    autoRotateSec: carousel.autoRotateSec,
    items,
  };
}
