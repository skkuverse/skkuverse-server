import { Injectable } from "@nestjs/common";
import { WEB_ORIGIN } from "../infra/origins";
import { registry } from "./miniapps.config";
import { resolveLogo } from "./miniapps.mapper";
import { isKnownMiniAppTarget, isSingleEmoji } from "./miniapps.rules";
import type { MiniAppDetailRaw, MiniAppLogoRaw } from "./miniapps.schema";
import type { MiniAppIndexEntry, MiniAppLogo } from "./miniapps.wire";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door other features read the registry through.
@Injectable()
export class MiniappsService {
  get version(): number {
    return registry.version;
  }

  get list(): ReadonlyArray<Readonly<MiniAppIndexEntry>> {
    return registry.indexEntries;
  }

  get map(): ReadonlyMap<string, Readonly<MiniAppDetailRaw>> {
    return registry.detailsById;
  }

  get firstPartyOrigins(): Readonly<Record<string, string>> {
    return registry.ownerByOrigin;
  }

  isRegistered(id: string): boolean {
    return registry.detailsById.has(id);
  }

  getDetail(id: string): Readonly<MiniAppDetailRaw> | undefined {
    return registry.detailsById.get(id);
  }

  isKnownMiniAppTarget(value: unknown): boolean {
    return isKnownMiniAppTarget(value, registry.detailsById);
  }

  resolveLogo(logo: MiniAppLogoRaw): MiniAppLogo {
    return resolveLogo(logo, WEB_ORIGIN);
  }

  isSingleEmoji(value: string): boolean {
    return isSingleEmoji(value);
  }
}
