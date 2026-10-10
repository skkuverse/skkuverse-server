import type { BuildingLabel, ConnectionEnds, FloorSpaceDoc } from "../building.document";
import { withEnFallback } from "../building.mapper";
import type { SkkuId } from "../building.types";
import { floorSortKey } from "./building-catalog.rules";
import type { BuildingConnection, FloorGroup } from "./building-catalog.types";

/** A building's spaces grouped by floor, lowest floor first (floorSortKey). */
function groupByFloor(spaces: readonly FloorSpaceDoc[]): FloorGroup[] {
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
function toBuildingConnections(
  skkuId: SkkuId,
  docs: readonly ConnectionEnds[],
  targets: readonly BuildingLabel[],
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

/** The buildings a building's connections lead to, itself excluded. */
function toConnectedSkkuIds(skkuId: SkkuId, docs: readonly ConnectionEnds[]): SkkuId[] {
  const ids = new Set<SkkuId>();
  for (const doc of docs) {
    ids.add(doc.a.skkuId);
    ids.add(doc.b.skkuId);
  }
  ids.delete(skkuId);
  return [...ids];
}

/** A building's floors with the English fallback applied to floor and space names. */
function withFloorEnFallback(floors: readonly FloorGroup[]): FloorGroup[] {
  return floors.map((f) => ({
    ...f,
    floor: withEnFallback(f.floor),
    spaces: f.spaces.map((s) => ({ ...s, name: withEnFallback(s.name) })),
  }));
}

export { groupByFloor, toConnectedSkkuIds, toBuildingConnections, withFloorEnFallback };
