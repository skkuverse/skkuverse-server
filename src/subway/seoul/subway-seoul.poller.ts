import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { SubwayTrackingService } from "../tracking/subway-tracking.service";
import { SubwaySeoulService } from "./subway-seoul.service";
import type { SettledProvider } from "./subway-seoul.types";

const API_POLL_INTERVAL_MS = 10_000;
const TRAIN_MAP_POLL_INTERVAL_MS = 15_000;

@Injectable()
export class SubwaySeoulPoller implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly seoul: SubwaySeoulService,
    private readonly tracking: SubwayTrackingService,
  ) {}

  // WHY: SUBWAY=off (the development default) registers nothing, so no upstream is called (ADR 0012, D5); the
  // tracker observes an upstream only in the service window.
  onModuleInit(): void {
    if (!config.subway.enabled) return logger.info({ event: "subway.seoul.disabled" }, "SUBWAY=off: subway pollers not registered");
    this.registerUpstream("subway-seoul", API_POLL_INTERVAL_MS, { observe: () => this.seoul.observeApi() });
    this.registerUpstream("subway-trainmap", TRAIN_MAP_POLL_INTERVAL_MS, { observe: () => this.seoul.observeTrainMap() });
  }

  private registerUpstream(name: string, intervalMs: number, upstream: SettledProvider): void {
    this.registry.registerPoller(() => this.trackSettled(upstream), intervalMs, name);
  }

  // WHY: what answered is tracked first; the tick then rejects with a failed call, so the registry reports it.
  private async trackSettled(upstream: SettledProvider): Promise<void> {
    const failures: unknown[] = [];
    await this.tracking.track({ observe: () => upstream.observe().then((settled) => { failures.push(...settled.failures); return settled; }) });
    if (failures.length > 0) throw failures[0];
  }
}
