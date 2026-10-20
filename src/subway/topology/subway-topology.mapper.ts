import type { SubwayNetwork, SubwayRegistry } from "../subway.types";
import type { SubwayTopologyData } from "./subway-topology.types";

// WHY: a served platform the topology has no entry for is left out of its station, so of the arrivals and the name maps.
export function toSubwayRegistry(network: SubwayNetwork, topology: SubwayTopologyData): SubwayRegistry {
  const stations = network.stations.map((station) => ({
    ...station,
    platforms: station.platforms.flatMap((platform) => {
      const directions = topology.platforms[platform.id];
      return directions === undefined ? [] : [{ ...platform, directions }];
    }),
  }));
  return { lines: [...network.lines], stations, neighbors: topology.neighbors };
}
