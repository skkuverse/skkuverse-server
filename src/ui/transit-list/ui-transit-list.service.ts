import { Injectable } from "@nestjs/common";
import { BusConfigService } from "../../bus/config/bus-config.service";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { toBusGroupCard } from "./ui-transit-list.mapper";
import { isBusGroupVisible } from "./ui-transit-list.rules";
import type { TransitList } from "./ui-transit-list.wire";

@Injectable()
export class UiTransitListService {
  constructor(
    private readonly busConfig: BusConfigService,
    private readonly clock: Clock,
  ) {}

  listBusGroupCards(lang: SupportedLang): TransitList {
    const now = this.clock.now();
    return this.busConfig
      .getBusGroups(lang)
      .filter((group) => isBusGroupVisible(group.visibility, now))
      .map(toBusGroupCard);
  }
}
