import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CacheControl } from "../../../http/cache-control.decorator";
import type { WithMeta } from "../../../http/response.types";
import { REALTIME_ROUTE_DEPRECATION } from "./bus-realtime-group.constants";
import { toDeprecatedCaller } from "./bus-realtime-group.mapper";
import { BusRealtimeGroupService } from "./bus-realtime-group.service";
import type { RealtimeGroup, RealtimeGroupMeta } from "./bus-realtime-group.wire";

@Controller("bus/realtime")
export class BusRealtimeGroupController {
  constructor(private readonly realtime: BusRealtimeGroupService) {}

  // WHY: deprecated (ADR 0019, D11): the body stays byte for byte, the headers name its successor.
  @Get("data/:groupId")
  @CacheControl("no-store")
  getGroup(@Param("groupId") groupId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<WithMeta<RealtimeGroup, RealtimeGroupMeta>> {
    this.realtime.recordDeprecatedCall(groupId, toDeprecatedCaller(req.headers));
    res.setHeader("Deprecation", REALTIME_ROUTE_DEPRECATION);
    res.setHeader("Link", `</bus/live/${encodeURIComponent(groupId)}>; rel="successor-version"`);
    return this.realtime.getGroup(groupId);
  }
}
