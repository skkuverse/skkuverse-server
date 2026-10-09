import { Injectable, type OnModuleInit } from "@nestjs/common";
import config from "../../infra/config";
import logger from "../../infra/logger";
import { PollerRegistryService } from "../../scheduling/poller-registry.service";
import { ScheduleService } from "../schedule/schedule.service";
import { BaselineEtaPoller } from "./baseline-eta-poller";
import { DailyCap } from "./daily-cap";
import { runsOn, upcomingRuns } from "./eta-runs";
import { etaSequences, sequenceLengths } from "./eta-sequences";
import { ensureEtaIndexes, readEtas, writeEtas } from "./eta-store";
import { LiveEtaPoller } from "./live-eta-poller";
import { fetchNaverOffsets } from "./naver-directions";
import { fetchTmapOffsets } from "./tmap-prediction";

const LIVE_INTERVAL_MS = 60_000;
const BASELINE_INTERVAL_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Registers the two arrival-estimate pollers (design D10) with the registry,
 * which starts them only outside ROLE=api. SHUTTLE_ETA=off (the development
 * default) registers nothing, so no directions call is made; serving still
 * applies whatever estimates are stored.
 *
 * The `shuttle_eta` indexes are ensured here, warn-and-continue like the
 * schedule indexes: the TTL index is what enforces TMAP's 24-hour term.
 */
@Injectable()
export class ShuttleEtaPollerService implements OnModuleInit {
  constructor(
    private readonly registry: PollerRegistryService,
    private readonly schedule: ScheduleService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!config.shuttleEta.enabled) {
      logger.info({ event: "bus.eta.disabled" }, "SHUTTLE_ETA=off: arrival-estimate pollers not registered");
      return;
    }
    try {
      await ensureEtaIndexes();
    } catch (err: unknown) {
      logger.warn({ event: "bus.eta.indexes_failed", err }, "ensureEtaIndexes failed (non-fatal)");
    }

    const { naver, tmapAppKey, naverDailyCap, tmapDailyCap } = config.shuttleEta;
    const sequences = etaSequences();
    const lengths = sequenceLengths(sequences);
    const store = {
      readEtas,
      writeEtas: (docs: Parameters<typeof writeEtas>[0]) => writeEtas(docs, lengths),
    };

    const live = new LiveEtaPoller({
      sequences,
      runsOn: (s, date) => runsOn(this.schedule, s.serviceId, s.routeType, s.stops.length, date),
      // config.ts exits at boot when a credential is missing.
      fetchOffsets: (stops) => fetchNaverOffsets(stops, { keyId: naver.keyId!, key: naver.key! }),
      cap: new DailyCap("naver", naverDailyCap),
      ...store,
    });
    const baseline = new BaselineEtaPoller({
      sequences,
      upcomingRuns: (s, now) => upcomingRuns(this.schedule, s.serviceId, s.routeType, s.stops.length, now),
      fetchOffsets: (stops, departAt) => fetchTmapOffsets(stops, departAt, tmapAppKey!),
      cap: new DailyCap("tmap", tmapDailyCap),
      sleep,
      ...store,
    });

    this.registry.registerPoller(() => live.tick(), LIVE_INTERVAL_MS, "shuttle-eta-live");
    this.registry.registerPoller(() => baseline.tick(), BASELINE_INTERVAL_MS, "shuttle-eta-baseline");
  }
}
