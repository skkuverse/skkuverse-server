import { Controller, Get, Param } from "@nestjs/common";
import { CacheControl } from "../../../http/cache-control.decorator";
import type { WithMeta } from "../../../http/response.types";
import { BusRealtimeGroupService } from "./bus-realtime-group.service";
import type { RealtimeGroup, RealtimeGroupMeta } from "./bus-realtime-group.wire";

@Controller("bus/realtime")
export class BusRealtimeGroupController {
  constructor(private readonly realtime: BusRealtimeGroupService) {}

  @Get("data/:groupId")
  @CacheControl("no-store")
  getGroup(@Param("groupId") groupId: string): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    return this.realtime.getGroup(groupId);
  }
}
