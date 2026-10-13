import type { Campus } from "../building/building.types";
import type { I18n } from "../infra/types";
import type { OverlayGeometry } from "../shared/geojson.types";
import type { LinkActionType } from "../shared/link-action.wire";
import type { PLACE_KINDS } from "./map.constants";

export interface PlaceAction {
  id: string;
  label: I18n;
  actionType: LinkActionType | "content";
  actionValue: string;
  style?: "primary" | "secondary";
}

/** WHY: absolute instants, never "18:00": a window crossing midnight needs no date arithmetic. `endAt: null` is unannounced. */
export interface OpeningWindow {
  startAt: Date;
  endAt: Date | null;
  label?: I18n | null;
}

type PlaceBlockDoc =
  | { type: "text"; id: string; title: I18n | null; body: I18n }
  | { type: "list"; id: string; title: I18n | null; items: Array<{ emoji: string | null; title: I18n; description: I18n | null }> }
  | { type: "table"; id: string; title: I18n | null; rows: Array<{ label: I18n; value: I18n }> }
  | { type: "image"; id: string; title: I18n | null; url: string; caption: I18n | null }
  | { type: "notice"; id: string; title: I18n | null; items: I18n[] };

type PlaceDetailActionDoc =
  | { type: "instagram"; id: string; label: I18n; profileUrl: string; postUrl: string | null }
  | { type: "link"; id: string; label: I18n; url: string };

export interface PlaceDetailDoc {
  kind: (typeof PLACE_KINDS)[number];
  org: I18n | null;
  isUnion: boolean;
  locationLabel: I18n | null;
  actions: PlaceDetailActionDoc[];
  blocks: PlaceBlockDoc[];
}

// CONTRACT(scripts): scripts/lib/map-places-file.js builds places and scripts/lib/eventmap-db.js writes them.
// SEE: docs/reference/event-places.md §2 for each field and who edits it.
export interface MapPlaceDoc {
  /** WHY: a human-authored slug, not an ObjectId: the ops sheet is keyed by it. */
  _id: string;
  layerSetId: string;
  campus: Campus;
  /** WHY: an open string: next year's category is a Mongo edit, not a deploy. */
  category: string;
  location: OverlayGeometry;
  title: I18n;
  subtitle?: I18n | null;
  /** WHY: empty means always open, and nothing else: a cancelled place is deleted, not flagged. */
  hours: OpeningWindow[];
  fields: Array<{ label: I18n; value: I18n }>;
  actions: PlaceAction[];
  order: number;
  facets?: Record<string, string[]>;
  orderByOption?: Record<string, number>;
  detail?: PlaceDetailDoc | null;
  updatedAt: Date;
}

// CONTRACT(scripts): scripts/lib/eventmap-db.js and scripts/eventmap-window.js write activations; ops edit them by hand.
export interface ActivationDoc {
  /** WHY: the layer set's id, so one activation per layer set. */
  _id: string;
  activeFrom: Date | null;
  activeUntil: Date | null;
  /** WHY: the ops kill switch that needs no deploy; it is why activations live in Mongo, not the layer-set file. */
  enabled: boolean;
  updatedAt: Date;
}

export type OverlayPlaceDoc = Pick<
  MapPlaceDoc,
  "_id" | "campus" | "category" | "location" | "title" | "subtitle" | "hours" | "fields" | "actions" | "order" | "facets" | "orderByOption"
>;

/** WHY: `detail` is read block by block and button by button, so the place read leaves it unknown. */
export type SheetPlaceDoc = Pick<MapPlaceDoc, "_id" | "category" | "location" | "title" | "hours" | "fields" | "actions"> & { detail?: unknown };

export type LiveActivation = Pick<ActivationDoc, "_id" | "activeUntil">;
