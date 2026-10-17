import { z } from "zod";
import { bannerCarousel } from "../ui.wire";

/**
 * CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/sdui/parser.ts, which skips a section
 * type it does not know.
 */
export const campusSheet = z.object({
  minAppVersion: z.string(),
  sections: z.array(bannerCarousel),
});

export type CampusSheet = z.input<typeof campusSheet>;
