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

const busItemFile = z.strictObject({ kind: z.literal("bus"), groupId: z.string() });
const subwayItemFile = z.strictObject({ kind: z.literal("subway"), stationId: z.string() });
const rowFileFields = { id: slug, title: localizedText, subtitle: localizedText.optional(), icon: transitIconFile };
const linkItemFile = z.strictObject({ kind: z.literal("link"), ...rowFileFields, actionType: linkActionType, actionValue: z.string() });

const transitChildFile = z.discriminatedUnion("kind", [busItemFile, subwayItemFile, linkItemFile], {
  error: "a group holds only bus, subway or link items",
});

const transitGroupFile = z.strictObject({
  kind: z.literal("group"),
  ...rowFileFields,
  initialState: z.enum(["collapsed", "expanded"]),
  visibleWith: busItemFile.optional(),
  items: z.array(transitChildFile).min(1),
});

const transitItemFile = z.discriminatedUnion("kind", [busItemFile, subwayItemFile, linkItemFile, transitGroupFile]);

const transitSectionFile = z.strictObject({
  type: z.literal("item_list"),
  id: slug,
  title: localizedText.optional(),
  items: z.array(transitItemFile).min(1),
});

type TransitSectionRaw = z.output<typeof transitSectionFile>;
const childrenOf = (item: TransitSectionRaw["items"][number]) => (item.kind === "group" ? item.items : []);

export const transitLayoutFile = z
  .strictObject({ version: z.literal(TRANSIT_LAYOUT_VERSION), sections: z.array(transitSectionFile) })
  .superRefine((layout, ctx) => {
    // WHY: an item id is the analytics id of a tap, and a repeat would place one group or station twice.
    const repeatedSection = findRepeatedId(layout.sections.map((section, i) => ({ id: section.id, path: ["sections", i, "id"] })));
    const repeatedItem = findRepeatedId(
      layout.sections.flatMap((section, sectionIndex) =>
        section.items.flatMap((item, itemIndex) => {
          const path = ["sections", sectionIndex, "items", itemIndex];
          return [{ id: toTransitItemId(item), path }, ...childrenOf(item).map((child, k) => ({ id: toTransitItemId(child), path: [...path, "items", k] }))];
        }),
      ),
    );
    if (repeatedSection) ctx.addIssue({ code: "custom", path: repeatedSection.path, message: `duplicate section id "${repeatedSection.id}"` });
    if (repeatedItem) ctx.addIssue({ code: "custom", path: repeatedItem.path, message: `item "${repeatedItem.id}" is placed more than once` });
  });

export type TransitLayoutRaw = z.output<typeof transitLayoutFile>;
export type TransitItemRaw = TransitSectionRaw["items"][number];
export type TransitChildRaw = z.output<typeof transitChildFile>;
