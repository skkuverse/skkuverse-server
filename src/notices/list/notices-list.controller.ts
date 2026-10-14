import { Controller, Get, Query } from "@nestjs/common";
import { RouteInput } from "../../http/route-input.decorator";
import { withMeta } from "../../http/response.interceptor";
import type { WithMeta } from "../../http/response.types";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { multiListRequest, sourceListRequest, type MultiListRequest, type SourceListRequest } from "./notices-list.schema";
import { NoticesListService } from "./notices-list.service";
import type { NoticeList, NoticeListMeta } from "./notices-list.wire";

const FIELD_CODES = { fieldCodes: { sourceId: "INVALID_SOURCE_ID", cursor: "INVALID_CURSOR" } };

@Controller("notices")
export class NoticesListController {
  constructor(private readonly list: NoticesListService) {}

  @Get("source/:sourceId")
  async bySource(
    @RouteInput(new ZodValidationPipe(sourceListRequest, "INVALID_PARAMS", FIELD_CODES)) request: SourceListRequest,
  ): Promise<WithMeta<NoticeList, NoticeListMeta>> {
    const { sourceId, ...query } = request;
    const list = await this.list.listNotices(sourceId, query);
    return withMeta(list, { count: list.notices.length });
  }

  @Get()
  async bySources(
    @Query(new ZodValidationPipe(multiListRequest, "INVALID_PARAMS", FIELD_CODES)) request: MultiListRequest,
  ): Promise<WithMeta<NoticeList, NoticeListMeta>> {
    const { sourceIds, ...query } = request;
    const list = await this.list.listNotices(sourceIds, query);
    return withMeta(list, { count: list.notices.length });
  }
}
