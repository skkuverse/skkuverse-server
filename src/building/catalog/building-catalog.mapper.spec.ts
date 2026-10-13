/**
 * The building detail's floor list and connections. What it guards:
 *  - floors sort basement → ground → rooftop numerically, and floors with no
 *    number (an empty name, a lobby) follow in the order they first appear;
 *  - spaces keep their input order within a floor and carry only the fields
 *    the floor list shows;
 *  - a connection is read from whichever end is this building, so `fromFloor`
 *    is always this building's floor, and a target missing from the read
 *    leaves the target's number and name empty;
 *  - the English fallback fills empty English names without touching the
 *    repository's objects.
 */
import type { SpaceCd, SkkuId } from "../building.types";
import type { BuildingLabel, ConnectionEnds, FloorSpaceDoc } from "./building-catalog.document";
import {
  groupByFloor,
  toBuildingConnections,
  toConnectedSkkuIds,
  withFloorEnFallback,
} from "./building-catalog.mapper";

function space(spaceCd: string, floorKo: string): FloorSpaceDoc {
  return {
    spaceCd: spaceCd as SpaceCd,
    name: { ko: `공간 ${spaceCd}`, en: `Space ${spaceCd}` },
    floor: { ko: floorKo, en: floorKo ? `${floorKo} (en)` : "" },
    conspaceCd: null,
  };
}

const id = (n: number): SkkuId => n as SkkuId;

describe("groupByFloor", () => {
  it("sorts floors numerically from basement to rooftop, unnumbered floors last in first-seen order", () => {
    // Arrange
    const spaces = ["로비", "2층", "옥탑1층", "10층", "", "지하1층", "1층", "지하2층"].map((floor, i) =>
      space(`S${i}`, floor),
    );

    // Act & Assert
    expect(groupByFloor(spaces).map((group) => group.floor.ko)).toEqual([
      "지하2층",
      "지하1층",
      "1층",
      "2층",
      "10층",
      "옥탑1층",
      "로비",
      "",
    ]);
  });

  it("keeps each floor's spaces in input order, with only the fields the floor list shows", () => {
    // Act
    const groups = groupByFloor([space("101", "1층"), space("201", "2층"), space("102", "1층")]);

    // Assert
    expect(groups[0]).toEqual({
      floor: { ko: "1층", en: "1층 (en)" },
      spaces: [
        { spaceCd: "101", name: { ko: "공간 101", en: "Space 101" }, conspaceCd: null },
        { spaceCd: "102", name: { ko: "공간 102", en: "Space 102" }, conspaceCd: null },
      ],
    });
  });
  it("throws on a space without a floor rather than filing it under a made-up one", () => {
    // Arrange
    const floorless = { ...space("102", "1층"), floor: undefined } as unknown as FloorSpaceDoc;

    // Act & Assert
    expect(() => groupByFloor([space("101", "1층"), floorless])).toThrow(TypeError);
  });
});

describe("toBuildingConnections", () => {
  const connections: ConnectionEnds[] = [
    { a: { skkuId: id(1), floor: { ko: "2층", en: "2F" } }, b: { skkuId: id(2), floor: { ko: "3층", en: "3F" } } },
    { a: { skkuId: id(3), floor: { ko: "1층", en: "1F" } }, b: { skkuId: id(1), floor: { ko: "지하1층", en: "B1" } } },
  ];
  const targets: BuildingLabel[] = [
    { _id: id(2), buildNo: "102", displayNo: "2", name: { ko: "수선관", en: "Suseon Hall" } } as BuildingLabel,
  ];

  it("reads each connection from this building's end, whichever side it is on", () => {
    // Act
    const [toTwo, toThree] = toBuildingConnections(id(1), connections, targets);

    // Assert
    expect(toTwo).toEqual({
      targetSkkuId: 2,
      targetBuildNo: "102",
      targetDisplayNo: "2",
      targetName: { ko: "수선관", en: "Suseon Hall" },
      fromFloor: { ko: "2층", en: "2F" },
      toFloor: { ko: "3층", en: "3F" },
    });
    expect(toThree).toMatchObject({
      targetSkkuId: 3,
      fromFloor: { ko: "지하1층", en: "B1" },
      toFloor: { ko: "1층", en: "1F" },
    });
  });

  it("leaves the target's number and name empty when the target was not read", () => {
    // Act
    const [, toThree] = toBuildingConnections(id(1), connections, targets);

    // Assert
    expect(toThree).toMatchObject({
      targetBuildNo: null,
      targetDisplayNo: null,
      targetName: { ko: "", en: "" },
    });
  });
});

describe("toConnectedSkkuIds", () => {
  it("lists each building at the far end once, never this building", () => {
    // Arrange
    const connections: ConnectionEnds[] = [
      { a: { skkuId: id(1), floor: { ko: "1층", en: "1F" } }, b: { skkuId: id(2), floor: { ko: "1층", en: "1F" } } },
      { a: { skkuId: id(2), floor: { ko: "2층", en: "2F" } }, b: { skkuId: id(1), floor: { ko: "2층", en: "2F" } } },
      { a: { skkuId: id(3), floor: { ko: "1층", en: "1F" } }, b: { skkuId: id(1), floor: { ko: "1층", en: "1F" } } },
    ];

    // Act & Assert
    expect(toConnectedSkkuIds(id(1), connections)).toEqual([2, 3]);
  });
});

describe("withFloorEnFallback", () => {
  it("fills empty English floor and space names from Korean, leaving the input as it was", () => {
    // Arrange
    const floors = Object.freeze([
      Object.freeze({
        floor: Object.freeze({ ko: "1층", en: "" }),
        spaces: Object.freeze([
          Object.freeze({ spaceCd: "101" as SpaceCd, name: Object.freeze({ ko: "강의실", en: "" }), conspaceCd: null }),
          Object.freeze({ spaceCd: "102" as SpaceCd, name: Object.freeze({ ko: "실험실", en: "Lab" }), conspaceCd: null }),
        ]),
      }),
    ]);

    // Act
    const [floor] = withFloorEnFallback(floors as never);

    // Assert
    expect(floor).toEqual({
      floor: { ko: "1층", en: "1층" },
      spaces: [
        { spaceCd: "101", name: { ko: "강의실", en: "강의실" }, conspaceCd: null },
        { spaceCd: "102", name: { ko: "실험실", en: "Lab" }, conspaceCd: null },
      ],
    });
    expect(floors[0]!.floor).toEqual({ ko: "1층", en: "" });
  });
});
