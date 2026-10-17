import type { BuildingDoc } from "../../building/building.document";
import type { ListedCafeteria } from "../../building/cafeteria-list/building-cafeteria-list.document";
import type { BilingualText, BuildNo } from "../../building/building.types";
import type { CafeteriaList } from "./meals-catalog.wire";

type CafeteriaListBuilding = NonNullable<CafeteriaList["cafeterias"][number]["building"]>;

function withEnFallback(text: BilingualText): BilingualText {
  return text.en ? text : { ...text, en: text.ko };
}

function toCafeteriaBuilding(building: BuildingDoc, buildNo: BuildNo): CafeteriaListBuilding {
  return {
    skkuId: building._id,
    buildNo,
    displayNo: building.displayNo,
    name: withEnFallback(building.name),
  };
}

function toCafeteriaList(cafeterias: readonly ListedCafeteria[], buildings: readonly BuildingDoc[]): CafeteriaList {
  const buildingByBuildNo = new Map<string, CafeteriaListBuilding>();
  for (const building of buildings) {
    if (building.buildNo) buildingByBuildNo.set(building.buildNo, toCafeteriaBuilding(building, building.buildNo));
  }
  return {
    cafeterias: cafeterias.map((cafeteria) => ({
      id: cafeteria._id,
      campus: cafeteria.campus,
      name: withEnFallback(cafeteria.name),
      building: buildingByBuildNo.get(cafeteria.buildNo) ?? null,
      floor: cafeteria.floor ? withEnFallback(cafeteria.floor) : null,
      spaceCd: cafeteria.spaceCd,
      location: cafeteria.location,
    })),
  };
}

export { toCafeteriaList };
