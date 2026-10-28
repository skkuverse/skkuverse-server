import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import { NoticesScreenService } from "../screen/notices-screen.service";
import { toDetailItem } from "./notices-detail.mapper";
import { NoticesDetailRepository } from "./notices-detail.repository";
import type { NoticeDetail } from "./notices-detail.wire";

@Injectable()
export class NoticesDetailService {
  constructor(
    private readonly repository: NoticesDetailRepository,
    private readonly screens: NoticesScreenService,
    private readonly legacy: NoticesLegacyService,
    private readonly clock: Clock,
  ) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetail | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    if (!doc) return null;
    const now = this.clock.now();
    return toDetailItem(doc, await this.screens.renderScreen(doc, now), this.legacy.deriveBrief(doc, now));
  }
}
