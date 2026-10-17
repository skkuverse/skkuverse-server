import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";

/** WHY: `type` is an open glyph name; the app draws a generic glyph for one it lacks and keeps `color` and `text`. */
const transitIcon = z.object({ type: z.string(), color: z.string(), text: z.string() });

const transitAction = z.object({ actionType: linkActionType, actionValue: z.string() });

const itemFields = { id: z.string(), title: z.string(), subtitle: z.string().nullable(), icon: transitIcon, action: transitAction };

/** WHY: `kind` names the referent and gates which build draws the item; `action` alone says where a tap goes. */
const transitItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bus"), groupId: z.string(), ...itemFields }),
  z.object({ kind: z.literal("subway"), stationId: z.string(), ...itemFields }),
  z.object({ kind: z.literal("link"), ...itemFields }),
]);

/** WHY: a null title draws no header above the section. */
const transitSection = z.object({ type: z.literal("item_list"), id: z.string(), title: z.string().nullable(), items: z.array(transitItem) });

/**
 * CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/transit/schema.ts parses this tolerantly and drops a
 * section of an unknown type or an item of an unknown kind, alone.
 */
export const transitLayout = z.object({ version: z.int(), sections: z.array(transitSection) });

export type TransitLayout = z.input<typeof transitLayout>;
