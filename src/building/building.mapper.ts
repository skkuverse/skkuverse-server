import { floorSortKey } from "./building.rules";
import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "./building.document";
import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import type {
  BilingualText,
  BuildingConnection,
  Campus,
  FloorGroup,
  SkkuId,
  WithCampusLabel,
} from "./building.types";

/** A building's spaces grouped by floor, lowest floor first (floorSortKey). */
function groupByFloor(
  spaces: ReadonlyArray<Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">>,
): FloorGroup[] {
  const floorMap = new Map<string, FloorGroup>();
  for (const s of spaces) {
    const key = s.floor?.ko || "unknown";
    if (!floorMap.has(key)) {
      floorMap.set(key, { floor: s.floor, spaces: [] });
    }
    floorMap.get(key)!.spaces.push({
      spaceCd: s.spaceCd,
      name: s.name,
      conspaceCd: s.conspaceCd,
    });
  }
  return Array.from(floorMap.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

/**
 * Connections as seen from `skkuId`. A connection doc is undirected (a/b), so
 * the side matching `skkuId` is "from" and the other is the target, named from
 * `targets` (the other buildings' docs).
 */
function toConnectionItems(
  skkuId: SkkuId,
  docs: readonly ConnectionDoc[],
  targets: ReadonlyArray<Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">>,
): BuildingConnection[] {
  const buildingMap = new Map(targets.map((b) => [b._id, b]));
  return docs.map((doc) => {
    const isA = doc.a.skkuId === skkuId;
    const self = isA ? doc.a : doc.b;
    const other = isA ? doc.b : doc.a;
    const target = buildingMap.get(other.skkuId);
    return {
      targetSkkuId: other.skkuId,
      targetBuildNo: target?.buildNo || null,
      targetDisplayNo: target?.displayNo || null,
      targetName: target?.name || { ko: "", en: "" },
      fromFloor: self.floor,
      toFloor: other.floor,
    };
  });
}

function campusLabel(campus: Campus, lang: SupportedLang): string {
  return t(`map.campus.${campus}.label`, lang);
}

function withCampusLabel<T extends { campus: Campus }>(item: T, lang: SupportedLang): WithCampusLabel<T> {
  return { ...item, campusLabel: campusLabel(item.campus, lang) };
}

/** An empty English side shows the Korean one. */
function withEnFallback<T extends Partial<BilingualText> | undefined>(text: T): T {
  if (text && !text.en && text.ko) return { ...text, en: text.ko };
  return text;
}

/** A building's floors with the English fallback applied to floor and space names. */
function withFloorEnFallback(floors: readonly FloorGroup[]): FloorGroup[] {
  return floors.map((f) => ({
    ...f,
    floor: withEnFallback(f.floor),
    spaces: f.spaces.map((s) => ({ ...s, name: withEnFallback(s.name) })),
  }));
}

export { campusLabel, groupByFloor, toConnectionItems, withCampusLabel, withEnFallback, withFloorEnFallback };
