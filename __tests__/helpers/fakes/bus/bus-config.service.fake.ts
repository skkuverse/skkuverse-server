/**
 * In-memory BusConfigService: the bus groups each language reads, set by the
 * test. The ETags are a stand-in, not the real md5 of the groups. A station's
 * direction, and every station's, is read from the set group by the real rules.
 */
import { toStationDirection, toStationDirections } from "../../../../src/bus/config/bus-config.rules";
import type { BusConfigService } from "../../../../src/bus/config/bus-config.service";
import type { PlacedStation, StationDirection } from "../../../../src/bus/config/bus-config.types";
import type { BusGroup } from "../../../../src/bus/config/bus-config.wire";
import type { SupportedLang } from "../../../../src/infra/types";
import type { PublicOf } from "../public-of";

export class FakeBusConfigService implements PublicOf<BusConfigService> {
  busGroupsByLang = new Map<SupportedLang, BusGroup[]>();

  listGroupIds(): string[] {
    return (this.busGroupsByLang.get("ko") ?? []).map((group) => group.id);
  }

  async getBusGroups(lang: SupportedLang = "ko"): Promise<BusGroup[]> {
    return this.busGroupsByLang.get(lang) ?? [];
  }

  async computeEtag(lang: SupportedLang = "ko"): Promise<string> {
    return `"fake-${lang}-${(await this.getBusGroups(lang)).length}"`;
  }

  async getGroupById(id: string, lang: SupportedLang = "ko"): Promise<BusGroup | null> {
    return (await this.getBusGroups(lang)).find((group) => group.id === id) ?? null;
  }

  async computeGroupEtag(id: string, lang: SupportedLang = "ko"): Promise<string | null> {
    return (await this.getGroupById(id, lang)) === null ? null : `"fake-${id}-${lang}"`;
  }

  async findStationDirection(id: string, { stationIndex, stationsVersion }: PlacedStation, lang: SupportedLang): Promise<StationDirection | null> {
    return toStationDirection(await this.getGroupById(id, lang), stationIndex, stationsVersion);
  }

  async listStationDirections(id: string, stationsVersion: string | null, lang: SupportedLang): Promise<Array<StationDirection | null>> {
    return toStationDirections(await this.getGroupById(id, lang), stationsVersion);
  }
}
