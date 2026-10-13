import { hasAnyText } from "../../infra/i18n";
import type { I18n } from "../../infra/types";
import { isAbsoluteHttpsUrl } from "../../shared/link-target.util";
import { isRecord } from "../../shared/object.util";
import type { SheetPlaceDoc } from "../map.document";
import { toI18nText } from "../map.mapper";
import { mediaUrl } from "../map.schema";
import type { I18nText } from "../map.wire";
import { PLACE_BLOCK_TYPES, PLACE_DETAIL_ACTION_TYPES } from "./map-event-details.constants";
import { isInstagramPostUrl, isInstagramProfileUrl, isNonBlankId, isPlaceKind } from "./map-event-details.rules";
import type { PlaceSheet } from "./map-event-details.wire";

type Block = PlaceSheet["blocks"][number];
type DetailAction = PlaceSheet["actions"][number];
type Raw = Record<string, unknown>;

function textOrNull(value: unknown): I18nText | null {
  return isRecord(value) && hasAnyText(value as unknown as I18n) ? toI18nText(value as unknown as I18n) : null;
}

function allOrNull<T>(value: unknown, read: (raw: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.map(read);
  return items.every((item): item is T => item !== null) ? items : null;
}

function toListItem(raw: unknown): { emoji: string | null; title: I18nText; description: I18nText | null } | null {
  const title = isRecord(raw) ? textOrNull(raw.title) : null;
  if (!isRecord(raw) || !title) return null;
  return { emoji: typeof raw.emoji === "string" && raw.emoji.trim() !== "" ? raw.emoji : null, title, description: textOrNull(raw.description) };
}

function toTableRow(raw: unknown): { label: I18nText; value: I18nText } | null {
  const label = isRecord(raw) ? textOrNull(raw.label) : null;
  const value = isRecord(raw) ? textOrNull(raw.value) : null;
  return label && value ? { label, value } : null;
}

const BLOCK_READERS: Readonly<Record<(typeof PLACE_BLOCK_TYPES)[number], (raw: Raw, id: string, title: I18nText | null) => Block | null>> = {
  text: (raw, id, title) => {
    const body = textOrNull(raw.body);
    return body ? { type: "text", id, title, body } : null;
  },
  list: (raw, id, title) => {
    const items = allOrNull(raw.items, toListItem);
    return items ? { type: "list", id, title, items } : null;
  },
  table: (raw, id, title) => {
    const rows = allOrNull(raw.rows, toTableRow);
    return rows ? { type: "table", id, title, rows } : null;
  },
  image: (raw, id, title) =>
    mediaUrl.safeParse(raw.url).success ? { type: "image", id, title, url: String(raw.url), caption: textOrNull(raw.caption) } : null,
  notice: (raw, id, title) => {
    const items = allOrNull(raw.items, textOrNull);
    return items ? { type: "notice", id, title, items } : null;
  },
};

function drop(dropped: string[], reason: string): null {
  dropped.push(reason);
  return null;
}

// WHY: a bad block or button is dropped on its own and logged; the importer cannot see a hand edit in Mongo.
function toBlock(raw: unknown, where: string, dropped: string[]): Block | null {
  if (!isRecord(raw) || !isNonBlankId(raw.id)) return drop(dropped, `${where}: not a block with an id`);
  const at = `${where}.${raw.id}`;
  const type = PLACE_BLOCK_TYPES.find((known) => known === String(raw.type));
  if (!type) return drop(dropped, `${at}: unknown block type "${String(raw.type)}"`);
  const block = BLOCK_READERS[type](raw, raw.id, textOrNull(raw.title));
  if (block) return block;
  dropped.push(raw.type === "image" ? `${at}: image url "${String(raw.url)}" is not on the media host` : `${at}: ${String(raw.type)} block is missing a required field`);
  return null;
}

function toInstagramAction(raw: Raw, head: { id: string; label: I18nText; at: string }, dropped: string[]): DetailAction | null {
  if (!isInstagramProfileUrl(raw.profileUrl)) {
    return drop(dropped, `${head.at}: profileUrl "${String(raw.profileUrl)}" is not an Instagram profile`);
  }
  // WHY: a bad post URL costs the post, not the button: the profile still opens.
  const postUrl = isInstagramPostUrl(raw.postUrl) ? raw.postUrl : null;
  if (raw.postUrl != null && postUrl === null) dropped.push(`${head.at}: postUrl "${String(raw.postUrl)}" is not an Instagram post`);
  return { type: "instagram", id: head.id, label: head.label, profileUrl: raw.profileUrl, postUrl };
}

function toDetailAction(raw: unknown, where: string, dropped: string[]): DetailAction | null {
  if (!isRecord(raw) || !isNonBlankId(raw.id)) return drop(dropped, `${where}: not an action with an id`);
  const at = `${where}.${raw.id}`;
  const label = textOrNull(raw.label);
  if (!label) return drop(dropped, `${at}: label is blank in every language`);
  const type = PLACE_DETAIL_ACTION_TYPES.find((known) => known === raw.type);
  if (!type) return drop(dropped, `${at}: unknown action type "${String(raw.type)}"`);
  if (type === "instagram") return toInstagramAction(raw, { id: raw.id, label, at }, dropped);
  if (isAbsoluteHttpsUrl(raw.url)) return { type: "link", id: raw.id, label, url: raw.url };
  return drop(dropped, `${at}: url "${String(raw.url)}" is not an absolute https URL`);
}

export function toPlaceSheet(doc: SheetPlaceDoc, dropped: string[]): PlaceSheet | null {
  const raw: unknown = doc.detail;
  if (!isRecord(raw) || !isPlaceKind(raw.kind) || !Array.isArray(raw.blocks) || !Array.isArray(raw.actions)) {
    return drop(dropped, `${doc._id}: detail is unreadable (kind, blocks or actions)`);
  }
  const blocks = raw.blocks.map((b, i) => toBlock(b, `${doc._id}.blocks[${i}]`, dropped));
  const actions = raw.actions.map((a, i) => toDetailAction(a, `${doc._id}.actions[${i}]`, dropped));
  return {
    placeId: doc._id,
    kind: raw.kind,
    org: textOrNull(raw.org),
    isUnion: raw.isUnion === true,
    locationLabel: textOrNull(raw.locationLabel),
    actions: actions.filter((a): a is DetailAction => a !== null),
    blocks: blocks.filter((b): b is Block => b !== null),
  };
}
