import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import { SUBWAY_NETWORK } from "../subway.constants";
import { TOPOLOGY_LOG_INTERVAL_MS } from "./subway-topology.constants";
import type { StoredSubwayTopology } from "./subway-topology.document";
import { SubwayTopologyReadError, SubwayTopologyUnavailableError } from "./subway-topology.error";
import { toSubwayRegistry } from "./subway-topology.mapper";
import { SubwayTopologyRepository } from "./subway-topology.repository";
import { toMissingPlatformIds, toUnknownPlatformIds } from "./subway-topology.rules";
import type { TopologySnapshot } from "./subway-topology.types";

// SEE: docs/explanation/subway-architecture.md ("Invariants"): the arrivals route and the Seoul pollers read the topology here.
@Injectable()
export class SubwayTopologyService {
  // WHY: a reload every TTL finds the same revision; its registry is built, and its gaps logged, once.
  private built: TopologySnapshot | null = null;
  private readonly loader: DatasetLoader<TopologySnapshot>;

  constructor(
    private readonly repository: SubwayTopologyRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "subway.topology",
      load: () => this.loadSnapshot(),
      clock,
      isReadError: (err): err is SubwayTopologyReadError => err instanceof SubwayTopologyReadError,
      toUnavailable: () => new SubwayTopologyUnavailableError(),
      readFailedEvent: "subway.topology.read_failed",
      logIntervalMs: TOPOLOGY_LOG_INTERVAL_MS,
    });
  }

  current(): Promise<TopologySnapshot> {
    return this.loader.get();
  }

  private async loadSnapshot(): Promise<TopologySnapshot | null> {
    const stored = await this.repository.findTopology();
    if (stored === null) return null;
    if (stored.revision === this.built?.revision) return this.built;
    this.logGaps(stored);
    this.built = { revision: stored.revision, registry: toSubwayRegistry(SUBWAY_NETWORK, stored.data) };
    return this.built;
  }

  private logGaps({ revision, data }: StoredSubwayTopology): void {
    const servedPlatformIds = SUBWAY_NETWORK.stations.flatMap((station) => station.platforms.map((platform) => platform.id));
    for (const platformId of toMissingPlatformIds(data, servedPlatformIds)) {
      logger.error({ event: "subway.topology.platform_missing", revision, platformId }, "A subway platform the code serves has no stored topology; not served");
    }
    for (const platformId of toUnknownPlatformIds(data, servedPlatformIds)) {
      logger.error({ event: "subway.topology.platform_unknown", revision, platformId }, "Stored topology names a subway platform the code does not serve; ignored");
    }
  }
}
