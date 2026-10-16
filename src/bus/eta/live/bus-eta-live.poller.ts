import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { DailyCap } from "../../../shared/daily-cap.util";
import { BusEtaService } from "../bus-eta.service";
import { BusEtaLiveClient } from "./bus-eta-live.client";
import { BusEtaLiveService } from "./bus-eta-live.service";

const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class BusEtaLivePoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly eta: BusEtaService,
    private readonly client: BusEtaLiveClient,
    private readonly clock: Clock,
  ) {}

  // WHY: SHUTTLE_ETA=off (the development default) registers nothing and calls no API; config.ts exits at boot without the keys.
  onModuleInit(): void {
    if (!config.shuttleEta.enabled) return logger.info({ event: "bus.eta.disabled", poller: "shuttle-eta-live" }, "SHUTTLE_ETA=off: poller not registered");
    const { naver, naverDailyCap } = config.shuttleEta;
    const live = new BusEtaLiveService({
      sequences: this.eta.sequences(),
      runsOn: (sequence, date) => this.eta.runsOn(sequence, date),
      fetchOffsets: (stops) => this.client.fetchOffsets(stops, { keyId: naver.keyId as string, key: naver.key as string }),
      readEtas: (serviceIds, dates) => this.eta.listFitting(serviceIds, dates),
      writeEtas: (docs) => this.eta.upsertFitting(docs),
      cap: new DailyCap("naver", naverDailyCap),
    });
    this.registry.registerPoller(() => live.tick(this.clock.now()), POLL_INTERVAL_MS, "shuttle-eta-live");
  }
}
