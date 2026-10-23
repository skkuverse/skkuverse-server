import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";

/** WHY: `type` is an open glyph name; the app draws a generic glyph for one it lacks and keeps `color` and `text`. */
const transitIcon = z.object({ type: z.string(), color: z.string(), text: z.string() });

const transitAction = z.object({ actionType: linkActionType, actionValue: z.string() });

const rowFields = { id: z.string(), title: z.string(), subtitle: z.string().nullable(), action: transitAction };

/**
 * WHY: one character in the request language, drawn in an outlined circle; `color`, six hex digits with no `#`,
 * is the outline's and the text's on the app's light background, so it may be darker than the line's `color`.
 */
const lineMarker = z.object({ text: z.string(), color: z.string() });

/** WHY: a line's display data comes from the server, so the app keeps no line table; `color` is six hex digits, no `#`. */
const transitLine = z.object({ code: z.string(), name: z.string(), color: z.string(), marker: lineMarker });

const busTransitItem = z.object({ kind: z.literal("bus"), groupId: z.string(), ...rowFields, icon: transitIcon });
/** WHY: one physical station; a marker per line in `lines` takes the place of the icon. */
const subwayTransitItem = z.object({ kind: z.literal("subway"), stationId: z.string(), ...rowFields, lines: z.array(transitLine).min(1) });
const linkTransitItem = z.object({ kind: z.literal("link"), ...rowFields, icon: transitIcon });

/**
 * WHY: a tap on a group folds or unfolds it, so it has no `action`; `initialState` is how it first draws, and
 * its children never hold a group.
 */
const groupTransitItem = z.object({
  kind: z.literal("group"),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  icon: transitIcon,
  initialState: z.enum(["collapsed", "expanded"]),
  items: z.array(z.discriminatedUnion("kind", [busTransitItem, subwayTransitItem, linkTransitItem])).min(1),
});

/** WHY: `kind` names the referent and gates which build draws the item; `action` alone says where a tap goes. */
const transitItem = z.discriminatedUnion("kind", [busTransitItem, subwayTransitItem, linkTransitItem, groupTransitItem]);

/**
 * WHY: a null title draws no header above the section. With no `campus` the section belongs to both campuses;
 * the app reads it for ordering only.
 */
const transitSection = z.object({
  type: z.literal("item_list"),
  id: z.string(),
  title: z.string().nullable(),
  campus: z.enum(["hssc", "nsc"]).optional(),
  items: z.array(transitItem),
});

/**
 * CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/transit/schema.ts parses this tolerantly and drops a
 * section of an unknown type or an item of an unknown kind, alone.
 */
export const transitLayout = z.object({ version: z.int(), sections: z.array(transitSection) });

export type TransitLayout = z.input<typeof transitLayout>;
