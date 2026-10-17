import { z } from "zod";
import { isHex6 } from "../../infra/color";
import { linkActionType } from "../../shared/link-action.wire";
import { findRepeatedId } from "../ui.rules";
import { localizedText, slug } from "../ui.schema";
import { TRANSIT_LAYOUT_VERSION } from "./ui-transit.constants";
import { toTransitItemId } from "./ui-transit.rules";

const transitIconFile = z.strictObject({
  type: slug,
  color: z.string().refine(isHex6, "must be six hex digits with no #"),
  text: localizedText,
});

const transitItemFile = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bus"), groupId: z.string() }),
  z.strictObject({ kind: z.literal("subway"), stationId: z.string() }),
  z.strictObject({
    kind: z.literal("link"),
    id: slug,
    title: localizedText,
    subtitle: localizedText.optional(),
    icon: transitIconFile,
    actionType: linkActionType,
    actionValue: z.string(),
  }),
]);

const transitSectionFile = z.strictObject({
  type: z.literal("item_list"),
  id: slug,
  title: localizedText,
  items: z.array(transitItemFile).min(1),
});

export const transitLayoutFile = z
  .strictObject({ version: z.literal(TRANSIT_LAYOUT_VERSION), sections: z.array(transitSectionFile) })
  .superRefine((layout, ctx) => {
    // WHY: an item id is the analytics id of a tap, and a repeat would place one group or station twice.
    const repeatedSection = findRepeatedId(layout.sections.map((section, i) => ({ id: section.id, path: ["sections", i, "id"] })));
    const repeatedItem = findRepeatedId(
      layout.sections.flatMap((section, i) => section.items.map((item, j) => ({ id: toTransitItemId(item), path: ["sections", i, "items", j] }))),
    );
    if (repeatedSection) ctx.addIssue({ code: "custom", path: repeatedSection.path, message: `duplicate section id "${repeatedSection.id}"` });
    if (repeatedItem) ctx.addIssue({ code: "custom", path: repeatedItem.path, message: `item "${repeatedItem.id}" is placed more than once` });
  });

export type TransitLayoutRaw = z.output<typeof transitLayoutFile>;
export type TransitItemRaw = TransitLayoutRaw["sections"][number]["items"][number];
