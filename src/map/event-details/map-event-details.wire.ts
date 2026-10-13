import { z } from "zod";
import { PLACE_KINDS } from "../map.constants";
import { i18nText } from "../map.wire";

const head = { id: z.string(), title: i18nText.nullable() };
const listItem = z.object({ emoji: z.string().nullable(), title: i18nText, description: i18nText.nullable() });

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/map/placeDetail.ts drops a block type it does not know. */
const placeBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), ...head, body: i18nText }),
  z.object({ type: z.literal("list"), ...head, items: z.array(listItem) }),
  z.object({ type: z.literal("table"), ...head, rows: z.array(z.object({ label: i18nText, value: i18nText })) }),
  z.object({ type: z.literal("image"), ...head, url: z.string(), caption: i18nText.nullable() }),
  z.object({ type: z.literal("notice"), ...head, items: z.array(i18nText) }),
]);

const detailAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("instagram"), id: z.string(), label: i18nText, profileUrl: z.string(), postUrl: z.string().nullable() }),
  z.object({ type: z.literal("link"), id: z.string(), label: i18nText, url: z.string() }),
]);

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/placeDetail.ts; `placeId` is the overlay's `tap.placeId`. */
const placeSheet = z.object({
  placeId: z.string(),
  kind: z.enum(PLACE_KINDS),
  org: i18nText.nullable(),
  isUnion: z.boolean(),
  locationLabel: i18nText.nullable(),
  actions: z.array(detailAction),
  blocks: z.array(placeBlock),
});

export const eventPlaceDetails = z.object({ details: z.record(z.string(), placeSheet) });

export type PlaceSheet = z.input<typeof placeSheet>;
export type EventPlaceDetails = z.input<typeof eventPlaceDetails>;
