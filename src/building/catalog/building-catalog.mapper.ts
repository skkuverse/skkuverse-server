import type { BuildingLabel, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";
import { withEnFallback } from "../building.mapper";
import type { SkkuId } from "../building.types";
import { floorSortKey } from "./building-catalog.rules";
import type { BuildingConnection, FloorGroup } from "./building-catalog.types";

function groupByFloor(spaces: readonly FloorSpaceDoc[]): FloorGroup[] {
  const floorGroupByFloorKo = new Map<string, FloorGroup>();
  for (const space of spaces) {
    const floorKo = space.floor?.ko || "unknown";
    if (!floorGroupByFloorKo.has(floorKo)) {
      floorGroupByFloorKo.set(floorKo, { floor: space.floor, spaces: [] });
    }
    floorGroupByFloorKo.get(floorKo)!.spaces.push({
      spaceCd: space.spaceCd,
      name: space.name,
      conspaceCd: space.conspaceCd,
    });
  }
  return Array.from(floorGroupByFloorKo.values()).sort(
    (a, b) => floorSortKey(a.floor?.ko) - floorSortKey(b.floor?.ko),
  );
}

/** A connection is unordered, so the end matching `skkuId` is "from" and the other the target. */
function toBuildingConnections(
  skkuId: SkkuId,
  connections: readonly ConnectionEnds[],
  targets: readonly BuildingLabel[],
): BuildingConnection[] {
  const targetBySkkuId = new Map(targets.map((target) => [target._id, target]));
  return connections.map((connection) => {
    const isA = connection.a.skkuId === skkuId;
    const self = isA ? connection.a : connection.b;
    const other = isA ? connection.b : connection.a;
    const target = targetBySkkuId.get(other.skkuId);
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

function toConnectedSkkuIds(skkuId: SkkuId, connections: readonly ConnectionEnds[]): SkkuId[] {
  const skkuIds = new Set<SkkuId>();
  for (const connection of connections) {
    skkuIds.add(connection.a.skkuId);
    skkuIds.add(connection.b.skkuId);
  }
  skkuIds.delete(skkuId);
  return [...skkuIds];
}

function withFloorEnFallback(floors: readonly FloorGroup[]): FloorGroup[] {
  return floors.map((floorGroup) => ({
    ...floorGroup,
    floor: withEnFallback(floorGroup.floor),
    spaces: floorGroup.spaces.map((space) => ({ ...space, name: withEnFallback(space.name) })),
  }));
}

export { groupByFloor, toConnectedSkkuIds, toBuildingConnections, withFloorEnFallback };
