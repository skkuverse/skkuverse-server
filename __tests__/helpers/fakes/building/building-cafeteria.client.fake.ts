/**
 * BuildingCafeteriaClient with scripted answers, already in the stored shape
 * the real client translates sisulList into (building-cafeteria.client.spec.ts
 * covers that translation). An Error in place of a campus's list rejects that
 * fetch. `calls` records each campus asked for, in order.
 */
import type { SyncedCafeteria } from "../../../../src/building/cafeteria/building-cafeteria.document";
import type { BuildingCafeteriaClient } from "../../../../src/building/cafeteria/building-cafeteria.client";
import type { Campus } from "../../../../src/building/building.types";
import type { PublicOf } from "../public-of";

export class FakeBuildingCafeteriaClient implements PublicOf<BuildingCafeteriaClient> {
  cafeterias: Record<Campus, SyncedCafeteria[] | Error> = { hssc: [], nsc: [] };
  calls: Campus[] = [];

  async fetchCafeterias(campus: Campus): Promise<SyncedCafeteria[]> {
    this.calls.push(campus);
    const answer = this.cafeterias[campus];
    if (answer instanceof Error) throw answer;
    return answer;
  }
}
