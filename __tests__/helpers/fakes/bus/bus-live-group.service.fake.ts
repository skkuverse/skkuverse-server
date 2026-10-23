/**
 * Scripted BusLiveGroupService for the stop page: `findLiveGroup` answers the live group set in `groups`, or rejects
 * with the error `failWith` holds for it, or with the 404 the real one answers for a group it has none of;
 * `readGroupIds` records every read. `getLiveGroup`, the live route's, is not the stop page's and rejects.
 * `findStationDirection` answers the direction set in `directions` under `<groupId>:<stationIndex>:<stationsVersion>`,
 * else null, as the real one does for a station /bus/config names none at.
 */
import { AppError } from "../../../../src/http/app.error";
import type { WithMeta } from "../../../../src/http/response.types";
import type { PlacedStation, StationDirection } from "../../../../src/bus/config/bus-config.types";
import type { BusLiveGroupService } from "../../../../src/bus/live/group/bus-live-group.service";
import type { LiveGroup, LiveGroupMeta } from "../../../../src/bus/live/bus-live.wire";
import type { PublicOf } from "../public-of";

export class FakeBusLiveGroupService implements PublicOf<BusLiveGroupService> {
  groups = new Map<string, LiveGroup>();
  failWith = new Map<string, Error>();
  readGroupIds: string[] = [];
  directions = new Map<string, StationDirection>();

  async getLiveGroup(groupId: string): Promise<WithMeta<LiveGroup, LiveGroupMeta>> {
    throw new Error(`the stop page never reads the live route of ${groupId}`);
  }

  async findLiveGroup(groupId: string): Promise<LiveGroup> {
    this.readGroupIds.push(groupId);
    const failure = this.failWith.get(groupId);
    if (failure) throw failure;
    const group = this.groups.get(groupId);
    if (!group) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    return structuredClone(group);
  }

  async findStationDirection(groupId: string, { stationIndex, stationsVersion }: PlacedStation): Promise<StationDirection | null> {
    return structuredClone(this.directions.get(`${groupId}:${stationIndex}:${stationsVersion}`) ?? null);
  }
}
