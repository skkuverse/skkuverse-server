import { Injectable } from "@nestjs/common";
import { toDetailItem } from "./notices-detail.mapper";
import { NoticesDetailRepository } from "./notices-detail.repository";
import type { NoticeDetail } from "./notices-detail.wire";

@Injectable()
export class NoticesDetailService {
  constructor(private readonly repository: NoticesDetailRepository) {}

  async findNotice(sourceId: string, articleNo: number): Promise<NoticeDetail | null> {
    const doc = await this.repository.findNotice(sourceId, articleNo);
    return doc ? toDetailItem(doc) : null;
  }
}
