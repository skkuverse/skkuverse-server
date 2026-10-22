/**
 * Scripted BusLiveJongroService: the live group set in `groups` for a Jongno route, null for any other group, and
 * `failWith`'s error for a route it holds one for.
 */
import type { BusLiveJongroService } from "../../../../src/bus/live/jongro/bus-live-jongro.service";
import type { LiveGroup } from "../../../../src/bus/live/bus-live.wire";
import type { PublicOf } from "../public-of";

export class FakeBusLiveJongroService implements PublicOf<BusLiveJongroService> {
  groups = new Map<string, LiveGroup>();
  failWith = new Map<string, Error>();

  async findLiveGroup(groupId: string): Promise<LiveGroup | null> {
    const failure = this.failWith.get(groupId);
    if (failure) throw failure;
    return structuredClone(this.groups.get(groupId) ?? null);
  }
}
