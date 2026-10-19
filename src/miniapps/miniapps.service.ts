import { Injectable } from "@nestjs/common";
import { WEB_ORIGIN } from "../infra/origins";
import { committedRegistry } from "./miniapps.config";
import { resolveLogo } from "./miniapps.mapper";
import { isSingleEmoji, parseMiniAppTarget } from "./miniapps.rules";
import type { MiniAppDetailRaw, MiniAppLogoRaw } from "./miniapps.schema";
import type { MiniAppTarget } from "./miniapps.types";
import type { MiniAppIndexEntry, MiniAppLogo } from "./miniapps.wire";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door other features read the registry through.
@Injectable()
export class MiniappsService {
  get version(): number {
    return committedRegistry.version;
  }

  get list(): ReadonlyArray<Readonly<MiniAppIndexEntry>> {
    return committedRegistry.indexEntries;
  }

  isRegistered(id: string): boolean {
    return committedRegistry.isRegistered(id);
  }

  getDetail(id: string): Readonly<MiniAppDetailRaw> | undefined {
    return committedRegistry.detailOf(id);
  }

  parseTarget(value: unknown): MiniAppTarget | null {
    return parseMiniAppTarget(value);
  }

  isKnownMiniAppTarget(value: unknown): boolean {
    return committedRegistry.isKnownMiniAppTarget(value);
  }

  resolveLogo(logo: MiniAppLogoRaw): MiniAppLogo {
    return resolveLogo(logo, WEB_ORIGIN);
  }

  isSingleEmoji(value: string): boolean {
    return isSingleEmoji(value);
  }
}
