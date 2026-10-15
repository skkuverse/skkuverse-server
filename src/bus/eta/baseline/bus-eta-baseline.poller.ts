import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { PollerRegistryService } from "../../../scheduling/poller-registry.service";
import { DailyCap } from "../bus-eta.rules";
import { BusEtaService } from "../bus-eta.service";
import { BusEtaBaselineClient } from "./bus-eta-baseline.client";
import { BusEtaBaselineService } from "./bus-eta-baseline.service";

const POLL_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class BusEtaBaselinePoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly eta: BusEtaService,
    private readonly client: BusEtaBaselineClient,
    private readonly clock: Clock,
  ) {}

  // WHY: SHUTTLE_ETA=off (the development default) registers nothing and calls no API; config.ts exits at boot without the keys.
  onModuleInit(): void {
    if (!config.shuttleEta.enabled) return logger.info({ event: "bus.eta.disabled", poller: "shuttle-eta-baseline" }, "SHUTTLE_ETA=off: poller not registered");
    const baseline = new BusEtaBaselineService({
      sequences: this.eta.sequences(),
      upcomingRuns: (sequence, now) => this.eta.upcomingRuns(sequence, now),
      fetchOffsets: (stops, departAt) => this.client.fetchOffsets(stops, departAt, { appKey: config.shuttleEta.tmapAppKey as string }),
      readEtas: (serviceIds, dates) => this.eta.listFitting(serviceIds, dates),
      writeEtas: (docs) => this.eta.upsertFitting(docs),
      cap: new DailyCap("tmap", config.shuttleEta.tmapDailyCap),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    this.registry.registerPoller(() => baseline.tick(this.clock.now()), POLL_INTERVAL_MS, "shuttle-eta-baseline");
  }
}
