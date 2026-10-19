import { Injectable } from "@nestjs/common";
import { BusConfigService } from "../../../bus/config/bus-config.service";
import { Clock } from "../../../infra/clock";
import type { SupportedLang } from "../../../infra/types";
import { SubwayStationsService } from "../../../subway/stations/subway-stations.service";
import { isBusGroupVisible } from "../../ui.rules";
import { UiTransitService } from "../ui-transit.service";
import type { TransitLayout } from "../ui-transit.wire";
import { toTransitSection } from "./ui-transit-tab.mapper";

@Injectable()
export class UiTransitTabService {
  constructor(
    private readonly layouts: UiTransitService,
    private readonly busConfig: BusConfigService,
    private readonly stations: SubwayStationsService,
    private readonly clock: Clock,
  ) {}

  async getTransitLayout(lang: SupportedLang): Promise<TransitLayout> {
    const servedStations = this.stations.listStations();
    const layout = await this.layouts.getStoredLayout({ busGroupIds: this.busConfig.listGroupIds(), stationIds: servedStations.map((station) => station.id) });
    const now = this.clock.now();
    const visibleGroups = (await this.busConfig.getBusGroups(lang)).filter((group) => isBusGroupVisible(group.visibility, now));
    const context = {
      lang,
      busGroupById: new Map(visibleGroups.map((group) => [group.id, group])),
      stationById: new Map(servedStations.map((station) => [station.id, station])),
    };
    const sections = layout.sections.map((section) => toTransitSection(section, context));
    // WHY: an emptied section is dropped, so the app never draws a header over nothing.
    return { version: layout.version, sections: sections.filter((section) => section.items.length > 0) };
  }
}
