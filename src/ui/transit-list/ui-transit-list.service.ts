import { Injectable } from "@nestjs/common";
import { BusConfigService } from "../../bus/config/bus-config.service";
import { Clock } from "../../infra/clock";
import { createLogThrottle } from "../../shared/log-throttle.util";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { isBusGroupVisible } from "../ui.rules";
import { toBusGroupCard } from "./ui-transit-list.mapper";
import type { TransitList } from "./ui-transit-list.wire";

const HOUR_MS = 60 * 60_000;

@Injectable()
export class UiTransitListService {
  private readonly legacyCallThrottle = createLogThrottle(HOUR_MS, () => this.clock.now().getTime());

  constructor(
    private readonly busConfig: BusConfigService,
    private readonly clock: Clock,
  ) {}

  // WHY: builds that predate GET /ui/home/transit still call this; an hourly line counts them until it is deleted.
  // SEE: docs/explanation/ui-architecture.md ("Open questions")
  async listBusGroupCards(lang: SupportedLang): Promise<TransitList> {
    const ticket = this.legacyCallThrottle.take("transitlist");
    if (ticket) {
      logger.warn({ event: "ui.transit_list.legacy_called", suppressed: ticket.suppressed }, "deprecated: /ui/home/transitlist called, use /ui/home/transit");
    }
    const now = this.clock.now();
    return (await this.busConfig.getBusGroups(lang))
      .filter((group) => isBusGroupVisible(group.visibility, now))
      .map(toBusGroupCard);
  }
}
