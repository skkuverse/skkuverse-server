import { Injectable } from "@nestjs/common";
import { BusConfigService } from "../../bus/config/bus-config.service";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { SubwayStationsService } from "../../subway/stations/subway-stations.service";
import { isBusGroupVisible } from "../ui.rules";
import { readTransitLayout } from "./ui-transit.config";
import { toTransitSection } from "./ui-transit.mapper";
import type { TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayout } from "./ui-transit.wire";

@Injectable()
export class UiTransitService {
  // WHY: read and checked against the bus groups, stations and registry when Nest builds the provider, so a bad file fails the boot.
  private readonly layout: Readonly<TransitLayoutRaw>;

  constructor(
    private readonly busConfig: BusConfigService,
    private readonly stations: SubwayStationsService,
    miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.layout = readTransitLayout({
      busGroupIds: busConfig.getBusGroups("ko").map((group) => group.id),
      stationIds: stations.listStations().map((station) => station.id),
      registry: miniApps,
    });
  }

  getTransitLayout(lang: SupportedLang): TransitLayout {
    const now = this.clock.now();
    const visibleGroups = this.busConfig.getBusGroups(lang).filter((group) => isBusGroupVisible(group.visibility, now));
    const context = {
      lang,
      busGroupById: new Map(visibleGroups.map((group) => [group.id, group])),
      stationById: new Map(this.stations.listStations().map((station) => [station.id, station])),
    };
    const sections = this.layout.sections.map((section) => toTransitSection(section, context));
    // WHY: an emptied section is dropped, so the app never draws a header over nothing.
    return { version: this.layout.version, sections: sections.filter((section) => section.items.length > 0) };
  }
}
