import type { BuildingLabel, CafeteriaSummary, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";
import { withEnFallback } from "../building.mapper";
import type { SkkuId } from "../building.types";
import { floorSortKey } from "./building-catalog.rules";
import type { BuildingConnection, FloorGroup } from "./building-catalog.types";
import type { BuildingDetail } from "./building-catalog.wire";

function groupByFloor(spaces: readonly FloorSpaceDoc[]): FloorGroup[] {
  const floorGroupByFloorKo = new Map<string, FloorGroup>();
  for (const space of spaces) {
    let floorGroup = floorGroupByFloorKo.get(space.floor.ko);
    if (!floorGroup) {
      floorGroup = { floor: space.floor, spaces: [] };
      floorGroupByFloorKo.set(space.floor.ko, floorGroup);
    }
    floorGroup.spaces.push({
      spaceCd: space.spaceCd,
      name: space.name,
      conspaceCd: space.conspaceCd,
    });
  }
  return Array.from(floorGroupByFloorKo.values()).sort(
    (a, b) => floorSortKey(a.floor.ko) - floorSortKey(b.floor.ko),
  );
}

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

function toBuildingCafeterias(cafeterias: readonly CafeteriaSummary[]): BuildingDetail["cafeterias"] {
  return cafeterias.map((cafeteria) => ({
    id: cafeteria._id,
    name: withEnFallback(cafeteria.name),
    floor: cafeteria.floor ? cafeteria.floor.ko : null,
    spaceCd: cafeteria.spaceCd,
  }));
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

export { groupByFloor, toBuildingCafeterias, toConnectedSkkuIds, toBuildingConnections, withFloorEnFallback };
