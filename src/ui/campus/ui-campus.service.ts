import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { readCampusBanners } from "./ui-campus.config";
import { toCampusSheet } from "./ui-campus.mapper";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusSheet } from "./ui-campus.wire";

@Injectable()
export class UiCampusService {
  // WHY: read and checked against the registry when Nest builds the provider, so a bad file fails the boot.
  private readonly banners: Readonly<CampusBannerCarouselRaw>;

  constructor(
    miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.banners = readCampusBanners(miniApps);
  }

  getCampusSheet(lang: SupportedLang): CampusSheet {
    return toCampusSheet({ banners: this.banners, lang, now: this.clock.now() });
  }
}
