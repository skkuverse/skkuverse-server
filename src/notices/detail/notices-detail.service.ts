import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesScreenService } from "../screen/notices-screen.service";
import { toDetailItem } from "./notices-detail.mapper";
import { NoticesDetailRepository } from "./notices-detail.repository";
import type { NoticeDetail } from "./notices-detail.wire";

@Injectable()
export class NoticesDetailService {
  constructor(
    private readonly repository: NoticesDetailRepository,
    private readonly screens: NoticesScreenService,
    private readonly clock: Clock,
  ) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetail | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    return doc ? toDetailItem(doc, await this.screens.renderScreen(doc, this.clock.now())) : null;
  }
}
