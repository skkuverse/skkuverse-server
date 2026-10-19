import { Injectable, type OnModuleInit } from "@nestjs/common";
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../../infra/origins";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { POLL_INTERVAL_MS } from "./miniapps-manifest.constants";
import { MiniappsManifestService } from "./miniapps-manifest.service";

@Injectable()
export class MiniappsManifestPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly manifests: MiniappsManifestService,
  ) {}

  // WHY: one poller per origin, so one mini app's origin down marks only its own poller failing.
  onModuleInit(): void {
    for (const origin of FIRST_PARTY_MINIAPP_ORIGINS) {
      const name = `miniapp-manifest-${new URL(origin).hostname}`;
      this.registry.registerPoller(() => this.manifests.refresh(origin), POLL_INTERVAL_MS, name);
    }
  }
}
