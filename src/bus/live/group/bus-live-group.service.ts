import { Injectable } from "@nestjs/common";
import { AppError } from "../../../http/app.error";
import { withMeta } from "../../../http/response.interceptor";
import type { WithMeta } from "../../../http/response.types";
import { Clock } from "../../../infra/clock";
import type { SupportedLang } from "../../../infra/types";
import { toKstInstant } from "../../../shared/kst-date.util";
import { BusConfigService } from "../../config/bus-config.service";
import type { PlacedStation, StationDirection } from "../../config/bus-config.types";
import { BusLiveHsscService } from "../hssc/bus-live-hssc.service";
import { BusLiveJongroService } from "../jongro/bus-live-jongro.service";
import { HSSC_GROUP_ID } from "../bus-live.constants";
import type { LiveGroup, LiveGroupMeta } from "../bus-live.wire";
import { withHeadsigns } from "./bus-live-group.mapper";

@Injectable()
export class BusLiveGroupService {
  constructor(
    private readonly jongro: BusLiveJongroService,
    private readonly hssc: BusLiveHsscService,
    private readonly config: BusConfigService,
    private readonly clock: Clock,
  ) {}

  async getLiveGroup(groupId: string, lang: SupportedLang): Promise<WithMeta<LiveGroup, LiveGroupMeta>> {
    const group = await this.findLiveGroup(groupId, lang);
    return withMeta(group, { serverNow: toKstInstant(this.clock.now().getTime()) });
  }

  // WHY: the one live answer of a group, which the live route and the stop page both serve (ADR 0019, D12), each call
  // headed where its station's /bus/config direction is (ADR 0022, D2).
  async findLiveGroup(groupId: string, lang: SupportedLang): Promise<LiveGroup> {
    const group = groupId === HSSC_GROUP_ID ? await this.hssc.findLiveGroup() : await this.jongro.findLiveGroup(groupId);
    if (group) return withHeadsigns(group, await this.config.listStationDirections(groupId, group.stationsVersion, lang));
    if (this.config.listGroupIds().includes(groupId)) throw new AppError("GROUP_NOT_LIVE", `Group ${groupId} has a timetable, not a live route`, 404);
    throw new AppError("GROUP_NOT_FOUND", `Unknown groupId: ${groupId}`, 404);
  }

  // WHY: the stop page names each live entry's direction, a /bus/config attribute the live route never repeats
  // (ADR 0019, D15), through this door, which already holds the config.
  async findStationDirection(groupId: string, station: PlacedStation, lang: SupportedLang): Promise<StationDirection | null> {
    return this.config.findStationDirection(groupId, station, lang);
  }
}
