import type { PlatformDirection, SubwayDirection, SubwayNeighbor, SubwayRegistry } from "../subway.types";

export interface SubwayTopologyData {
  platforms: Record<string, Readonly<Record<SubwayDirection, PlatformDirection>>>;
  neighbors: Record<string, SubwayNeighbor>;
}

/** WHY: one revision of the stored topology joined to the code-held network, built once per revision. */
export interface TopologySnapshot {
  revision: number;
  registry: SubwayRegistry;
}
