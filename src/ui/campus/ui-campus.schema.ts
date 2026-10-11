import { z } from "zod";
import { findDuplicateId } from "../ui.rules";
import { bannerImage, carouselFields } from "../ui.schema";

// WHY: images only: the campus sheet has no built-in banner for a `default` item to stand for.
export const campusBannersFile = z
  .strictObject({ ...carouselFields, items: z.array(bannerImage).min(1) })
  .superRefine((carousel, ctx) => {
    const duplicateId = findDuplicateId([carousel.id, ...carousel.items.map((image) => image.id)]);
    if (duplicateId) ctx.addIssue({ code: "custom", message: `duplicate id "${duplicateId}"` });
  });

export type CampusBannerCarouselRaw = z.output<typeof campusBannersFile>;
