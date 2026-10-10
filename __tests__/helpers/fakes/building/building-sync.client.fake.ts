/**
 * BuildingSyncClient with scripted answers, already in the domain shapes the
 * real client translates SKKU's payloads into (building-sync.client.spec.ts
 * covers that translation). An Error in place of a campus's list rejects that
 * fetch; `buildInfo` answers one building at a time and may reject or wait.
 * `calls` records every request in order.
 */
import type { Campus } from "../../../../src/building/building.types";
import type { BuildingSyncClient } from "../../../../src/building/sync/building-sync.client";
import type {
  BuildInfo,
  ListedBuilding,
  ListedBuildingWithBuildNo,
  SyncedSpace,
} from "../../../../src/building/sync/building-sync.types";
import type { PublicOf } from "../public-of";

export type ClientCall =
  | { mode: "buildList"; campus: Campus }
  | { mode: "buildInfo"; skkuId: number; buildNo: string }
  | { mode: "spaceList"; campus: Campus };

export class FakeBuildingSyncClient implements PublicOf<BuildingSyncClient> {
  buildLists: Record<Campus, ListedBuilding[] | Error> = { hssc: [], nsc: [] };
  spaceLists: Record<Campus, SyncedSpace[] | Error> = { hssc: [], nsc: [] };
  buildInfo: (building: ListedBuildingWithBuildNo) => Promise<BuildInfo> = async () => ({ attachments: [], spaces: [] });
  calls: ClientCall[] = [];

  async fetchBuildList(campus: Campus): Promise<ListedBuilding[]> {
    this.calls.push({ mode: "buildList", campus });
    const answer = this.buildLists[campus];
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async fetchBuildInfo(building: ListedBuildingWithBuildNo): Promise<BuildInfo> {
    this.calls.push({ mode: "buildInfo", skkuId: building.skkuId, buildNo: building.doc.buildNo });
    return this.buildInfo(building);
  }

  async fetchSpaceList(campus: Campus): Promise<SyncedSpace[]> {
    this.calls.push({ mode: "spaceList", campus });
    const answer = this.spaceLists[campus];
    if (answer instanceof Error) throw answer;
    return answer;
  }

  /** The requests of one mode, in order. */
  callsOf<M extends ClientCall["mode"]>(mode: M): Array<Extract<ClientCall, { mode: M }>> {
    return this.calls.filter((call): call is Extract<ClientCall, { mode: M }> => call.mode === mode);
  }
}
