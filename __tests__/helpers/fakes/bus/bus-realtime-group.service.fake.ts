/**
 * Scripted BusRealtimeGroupService for the stop page: `findGroupView` answers the view set in `views` for a group,
 * null for one with none, or rejects with the error `failWith` holds for it; `readGroupIds` records every read.
 * `getGroup`, the realtime route's, is not the stop page's and rejects.
 */
import type { WithMeta } from "../../../../src/http/response.types";
import type { BusRealtimeGroupService } from "../../../../src/bus/realtime/group/bus-realtime-group.service";
import type { GroupView } from "../../../../src/bus/realtime/group/bus-realtime-group.types";
import type { RealtimeGroup, RealtimeGroupMeta } from "../../../../src/bus/realtime/group/bus-realtime-group.wire";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeGroupService implements PublicOf<BusRealtimeGroupService> {
  views = new Map<string, GroupView>();
  failWith = new Map<string, Error>();
  readGroupIds: string[] = [];

  async getGroup(groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    throw new Error(`the stop page never reads the realtime route of ${groupId}`);
  }

  async findGroupView(groupId: string): Promise<GroupView | null> {
    this.readGroupIds.push(groupId);
    const failure = this.failWith.get(groupId);
    if (failure) throw failure;
    return structuredClone(this.views.get(groupId) ?? null);
  }
}
