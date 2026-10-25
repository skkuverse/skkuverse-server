import { z } from "zod";
import { bannerCarousel } from "../ui.wire";

/**
 * CONTRACT(skkuverse-app): parsed by skkuverse-app/apps/mobile/src/features/map/campus-sheet/campus-sheet.schema.ts,
 * which reads a section type it does not know as `unknown`.
 */
export const campusSheet = z.object({
  minAppVersion: z.string(),
  sections: z.array(bannerCarousel),
});

export type CampusSheet = z.input<typeof campusSheet>;
