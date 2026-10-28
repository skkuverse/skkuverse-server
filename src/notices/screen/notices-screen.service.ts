import { Injectable } from "@nestjs/common";
import { BuildingPlaceDisplayService } from "../../building/place/display/building-place-display.service";
import type { NoticeScreen } from "../notices.wire";
import { NoticesRowService } from "../row/notices-row.service";
import { toOriginal, toScreenBlocks } from "./notices-screen.mapper";
import { isPosterOnly, toBarAction, toBlockOrder, toCollapse, toDisplayByPlaceId, toFirstSeen, toHeaderChange, toPlaceIds, toStatusLine } from "./notices-screen.rules";
import type { ScreenNotice, ScreenScope } from "./notices-screen.types";

@Injectable()
export class NoticesScreenService {
  constructor(
    private readonly rows: NoticesRowService,
    private readonly places: BuildingPlaceDisplayService,
  ) {}

  async renderScreen(notice: ScreenNotice, now: Date): Promise<NoticeScreen | null> {
    const reading = this.rows.readNotice(notice, now);
    if (!reading) return null;
    const placeIds = toPlaceIds(reading);
    const displays = placeIds.length > 0 ? await this.places.describePlaces(placeIds) : [];
    const scope: ScreenScope = { reading, displayByPlaceId: toDisplayByPlaceId(placeIds, displays) };
    return {
      // CONTRACT(skkuverse-crawler): `firstSeenAt` is written once per copy; a copy stored before it lacks it, and the crawler dates it by its `_id` (skkuverse-crawler/docs/notice-facts/design.md "Storage").
      header: { firstSeen: toFirstSeen(notice.firstSeenAt ?? notice._id.getTimestamp(), reading), change: toHeaderChange(scope) },
      status: toStatusLine(reading),
      blocks: toScreenBlocks(scope, toBlockOrder(notice.category, reading)),
      action: toBarAction(reading),
      collapsed: toCollapse(reading),
      staffOnly: reading.isStaffOnly,
      posterOnly: isPosterOnly(reading.facts),
      original: toOriginal(reading.facts),
    };
  }
}
