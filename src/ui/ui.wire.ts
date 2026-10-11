import { z } from "zod";
import { linkActionType } from "../shared/link-action.wire";

const bannerImage = z.object({
  type: z.literal("image"),
  /** WHY: the analytics item id for a tap. */
  id: z.string(),
  imageUrl: z.string(),
  /** WHY: the screen-reader label: an image banner has no other text. */
  alt: z.string(),
  actionType: linkActionType.optional(),
  actionValue: z.string().optional(),
});

/**
 * CONTRACT(skkuverse-app): skkuverse-app/apps/mobile/src/features/home/HomeBannerCarousel.tsx draws its
 * built-in banner where this item sits.
 */
const defaultBanner = z.object({ type: z.literal("default") });

export const bannerCarousel = z.object({
  type: z.literal("banner_carousel"),
  id: z.string(),
  /** WHY: width / height of every page in the slot. */
  aspectRatio: z.number(),
  /** WHY: seconds per page; 0 turns rotation off. */
  autoRotateSec: z.int(),
  items: z.array(z.discriminatedUnion("type", [bannerImage, defaultBanner])),
});

export type BannerCarousel = z.input<typeof bannerCarousel>;
