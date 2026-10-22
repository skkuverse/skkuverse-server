import { Controller, Get, Param } from "@nestjs/common";
import { CacheControl } from "../../../http/cache-control.decorator";
import type { WithMeta } from "../../../http/response.types";
import type { LiveGroup, LiveGroupMeta } from "../bus-live.wire";
import { LIVE_CACHE_CONTROL } from "./bus-live-group.constants";
import { BusLiveGroupService } from "./bus-live-group.service";

@Controller("bus/live")
export class BusLiveGroupController {
  constructor(private readonly live: BusLiveGroupService) {}

  @Get(":groupId")
  @CacheControl(LIVE_CACHE_CONTROL)
  getLiveGroup(@Param("groupId") groupId: string): Promise<WithMeta<LiveGroup, LiveGroupMeta>> {
    return this.live.getLiveGroup(groupId);
  }
}
