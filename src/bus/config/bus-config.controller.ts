import { Controller, Get, Param, UseInterceptors } from "@nestjs/common";
import { AppError } from "../../http/app.error";
import { CacheControl } from "../../http/cache-control.decorator";
import { EtagInterceptor, withEtag } from "../../http/etag.interceptor";
import { Lang } from "../../http/lang.decorator";
import type { WithEtag } from "../../http/response.types";
import type { SupportedLang } from "../../infra/types";
import { BusConfigService } from "./bus-config.service";
import type { BusConfig, BusGroup } from "./bus-config.wire";

const CONFIG_CACHE_CONTROL = "public, max-age=300";

@Controller("bus/config")
export class BusConfigController {
  constructor(private readonly busConfig: BusConfigService) {}

  @Get()
  @UseInterceptors(EtagInterceptor)
  @CacheControl(CONFIG_CACHE_CONTROL)
  getConfig(@Lang() lang: SupportedLang): WithEtag<BusConfig> {
    return withEtag({ groups: this.busConfig.getBusGroups(lang) }, this.busConfig.computeEtag(lang));
  }

  // WHY: an unknown group is a 404 even with If-None-Match: the lookup comes before the ETag check.
  @Get(":groupId")
  @UseInterceptors(EtagInterceptor)
  @CacheControl(CONFIG_CACHE_CONTROL)
  getGroup(@Param("groupId") groupId: string, @Lang() lang: SupportedLang): WithEtag<BusGroup> {
    const etag = this.busConfig.computeGroupEtag(groupId, lang);
    const group = this.busConfig.getGroupById(groupId, lang);
    if (!etag || !group) throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
    return withEtag(group, etag);
  }
}
