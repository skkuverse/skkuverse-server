/**
 * In-memory BusConfigService: the bus groups each language reads, set by the
 * test. The ETags are a stand-in, not the real md5 of the groups.
 */
import type { BusConfigService } from "../../../../src/bus/config/bus-config.service";
import type { BusGroup } from "../../../../src/bus/config/bus-config.wire";
import type { SupportedLang } from "../../../../src/infra/types";
import type { PublicOf } from "../public-of";

export class FakeBusConfigService implements PublicOf<BusConfigService> {
  busGroupsByLang = new Map<SupportedLang, BusGroup[]>();

  getBusGroups(lang: SupportedLang = "ko"): BusGroup[] {
    return this.busGroupsByLang.get(lang) ?? [];
  }

  computeEtag(lang: SupportedLang = "ko"): string {
    return `"fake-${lang}-${this.getBusGroups(lang).length}"`;
  }

  getGroupById(id: string, lang: SupportedLang = "ko"): BusGroup | null {
    return this.getBusGroups(lang).find((group) => group.id === id) ?? null;
  }

  computeGroupEtag(id: string, lang: SupportedLang = "ko"): string | null {
    return this.getGroupById(id, lang) === null ? null : `"fake-${id}-${lang}"`;
  }
}
