import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";
import { bannerCarousel } from "../ui.wire";

const campusButton = z.object({
  id: z.string(),
  title: z.string(),
  emoji: z.string(),
  actionType: linkActionType,
  actionValue: z.string(),
  webviewTitle: z.string().optional(),
  webviewColor: z.string().optional(),
});

const buttonGrid = z.object({
  type: z.literal("button_grid"),
  id: z.string(),
  columns: z.int(),
  items: z.array(campusButton),
});

/**
 * CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/sdui/parser.ts, which skips a section
 * type it does not know.
 */
export const campusSheet = z.object({
  minAppVersion: z.string(),
  sections: z.array(z.discriminatedUnion("type", [bannerCarousel, buttonGrid])),
});

export type CampusSheet = z.input<typeof campusSheet>;
