import { z } from "zod";
import { findRepeatedId } from "../ui.rules";
import { bannerImageFile, carouselFields } from "../ui.schema";
import type { StoredCampusBanners } from "./ui-campus.document";

// WHY: images only: the campus sheet has no built-in banner for a `default` item to stand for.
export const campusBannersFile = z
  .strictObject({ ...carouselFields, items: z.array(bannerImageFile).min(1) })
  .superRefine((carousel, ctx) => {
    const images = carousel.items.map((image, i) => ({ id: image.id, path: ["items", i, "id"] }));
    const repeat = findRepeatedId([{ id: carousel.id, path: ["id"] }, ...images]);
    if (repeat) ctx.addIssue({ code: "custom", path: repeat.path, message: `duplicate id "${repeat.id}"` });
  });

export type CampusBannerCarouselRaw = z.output<typeof campusBannersFile>;

export const storedCampusBanners = z.object({ revision: z.int().positive(), data: campusBannersFile }) satisfies z.ZodType<StoredCampusBanners>;
