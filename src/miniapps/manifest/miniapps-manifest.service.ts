import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../../infra/origins";
import type { ShellConfig } from "../miniapps.wire";
import { MiniappsManifestClient } from "./miniapps-manifest.client";
import { MiniappsManifestRepository } from "./miniapps-manifest.repository";
import { firstPartyOrigin } from "./miniapps-manifest.rules";

@Injectable()
export class MiniappsManifestService {
  constructor(
    private readonly client: MiniappsManifestClient,
    private readonly repository: MiniappsManifestRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: logs no failure itself; the poller registry reports the rejection, and a failed fetch writes nothing,
  // so the origin's last good manifest stays stored.
  async refresh(origin: string): Promise<void> {
    const shell = await this.client.fetchShellFields(origin);
    await this.repository.upsertManifest(origin, shell, this.clock.now());
  }

  fetchShellFields(origin: string): Promise<Partial<ShellConfig>> {
    return this.client.fetchShellFields(origin);
  }

  firstPartyOriginOf(startUrl: string): string | null {
    return firstPartyOrigin(startUrl, FIRST_PARTY_MINIAPP_ORIGINS);
  }
}
