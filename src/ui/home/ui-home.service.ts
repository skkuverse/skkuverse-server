import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import type { SupportedLang } from "../../infra/types";
import { MiniAppsService } from "../../miniapps/miniapps.service";
import { readHomeLayout } from "./ui-home.config";
import { toHomeLayout } from "./ui-home.mapper";
import type { HomeLayoutRaw } from "./ui-home.schema";
import type { HomeLayout } from "./ui-home.wire";

@Injectable()
export class UiHomeService {
  // WHY: read and checked against the registry when Nest builds the provider, so a bad file fails the boot.
  private readonly layout: Readonly<HomeLayoutRaw>;

  constructor(
    private readonly miniApps: MiniAppsService,
    private readonly clock: Clock,
  ) {
    this.layout = readHomeLayout(miniApps);
  }

  getHomeLayout(lang: SupportedLang): HomeLayout {
    const resolveLogo = this.miniApps.resolveLogo.bind(this.miniApps);
    return toHomeLayout(this.layout, { lang, now: this.clock.now(), resolveLogo });
  }
}
