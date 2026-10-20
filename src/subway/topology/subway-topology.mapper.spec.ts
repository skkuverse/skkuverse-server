/**
 * toSubwayRegistry, the code-held network joined to one stored topology
 * (move-reference-datasets D2, D3): every served platform takes its two
 * directions from the topology, the neighbors are the topology's, and the
 * lines and stations keep the code's order and labels. A served platform the
 * topology has no entry for is left out of its station; an entry for a
 * platform the code does not serve joins nothing.
 *
 * Until subway-registry.json is deleted (task 10.6, which deletes the last
 * describe here), revision 1 joined to SUBWAY_NETWORK equals the registry the
 * committed file loads.
 */
import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { SUBWAY_REGISTRY } from "../subway.config";
import { SUBWAY_NETWORK } from "../subway.constants";
import { toSubwayRegistry } from "./subway-topology.mapper";

describe("toSubwayRegistry", () => {
  it("gives every served platform its stored directions, in the code's station and platform order", () => {
    // Arrange
    const topology = subwayTopologyFixture();

    // Act
    const registry = toSubwayRegistry(SUBWAY_NETWORK, topology);

    // Assert
    expect(registry.stations.flatMap((station) => station.platforms.map((platform) => platform.id))).toEqual(Object.keys(topology.platforms));
    expect(registry.stations[1]?.platforms[0]).toEqual({ ...SUBWAY_NETWORK.stations[1]?.platforms[0], directions: topology.platforms["S1-4-420"] });
    expect(registry.neighbors).toEqual(topology.neighbors);
    expect(registry.lines).toEqual(SUBWAY_NETWORK.lines);
  });

  it("leaves a served platform the topology has no entry for out of its station, and keeps the station's other platform", () => {
    // Arrange
    const topology = subwayTopologyFixture();
    delete topology.platforms["S1-2-222"];

    // Act
    const gangnam = toSubwayRegistry(SUBWAY_NETWORK, topology).stations.find((station) => station.id === "gangnam");

    // Assert
    expect(gangnam?.platforms.map((platform) => platform.id)).toEqual(["DX-D1-4307"]);
  });

  it("joins nothing to an entry for a platform the code does not serve", () => {
    // Arrange
    const topology = subwayTopologyFixture();
    topology.platforms["S1-9-999"] = topology.platforms["S1-4-420"]!;

    // Act
    const registry = toSubwayRegistry(SUBWAY_NETWORK, topology);

    // Assert
    expect(registry.stations.flatMap((station) => station.platforms.map((platform) => platform.id))).not.toContain("S1-9-999");
  });
});

describe("toSubwayRegistry over revision 1 against the committed registry", () => {
  it("equals SUBWAY_REGISTRY, which subway-registry.json loads", () => {
    // Act
    const registry = toSubwayRegistry(SUBWAY_NETWORK, subwayTopologyFixture());

    // Assert
    expect(registry).toEqual(SUBWAY_REGISTRY);
  });
});
