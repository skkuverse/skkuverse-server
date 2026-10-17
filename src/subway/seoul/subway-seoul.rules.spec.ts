/**
 * The lines the `seoul` provider polls, derived from the registry: one per
 * line, with the Seoul API's ids, the train-map line, the served stations to
 * ask arrivals for, and the tables from each name the line's rows write (its
 * served platforms and its neighbors) to its platform id, by the Seoul API's
 * name and by the train map's where a neighbor's differs. And one upstream
 * tick's calls settled apart: what answered is kept beside what failed, and
 * only a tick whose every call failed has nothing to hand on.
 */
import { SUBWAY_REGISTRY } from "../subway.config";
import type { CountdownRow, SubwayRegistry, TrainEvent } from "../subway.types";
import { toSeoulLines, toSettledObservations } from "./subway-seoul.rules";

const copyOf = (): SubwayRegistry => JSON.parse(JSON.stringify(SUBWAY_REGISTRY)) as SubwayRegistry;
const tables = ({ platformIdByApiName, platformIdByTrainMapName, ...line }: ReturnType<typeof toSeoulLines>[number]) => ({
  ...line,
  platformIdByApiName: Object.fromEntries(platformIdByApiName),
  platformIdByTrainMapName: Object.fromEntries(platformIdByTrainMapName),
});

const LINE_1_NAMES = {
  성균관대: "KR-1-0153",
  금정: "KR-1-P149",
  군포: "KR-1-P150",
  당정: "KR-1-P151",
  의왕: "KR-1-P152",
  화서: "KR-1-P154",
  수원: "KR-1-P155",
  세류: "KR-1-1715",
};
const LINE_4_NAMES = {
  혜화: "S1-4-420",
  길음: "S1-4-417",
  성신여대입구: "S1-4-418",
  한성대입구: "S1-4-419",
  동대문: "S1-4-421",
  동대문역사문화공원: "S1-4-422",
  충무로: "S1-4-423",
};

describe("toSeoulLines", () => {
  it("gives 1호선 and 4호선, each with its served station and the Seoul names of its platforms, 금정 watched beyond 1호선's", () => {
    // Act
    const lines = toSeoulLines(SUBWAY_REGISTRY);

    // Assert
    expect(lines.map(tables)).toEqual([
      {
        subwayId: "1001",
        lineName: "1호선",
        trainMapLine: "1",
        trainNumbers: "timetable",
        stationNames: ["성균관대"],
        platformIdByApiName: LINE_1_NAMES,
        platformIdByTrainMapName: LINE_1_NAMES,
      },
      {
        subwayId: "1004",
        lineName: "4호선",
        trainMapLine: "4",
        trainNumbers: "timetable",
        stationNames: ["혜화"],
        platformIdByApiName: LINE_4_NAMES,
        platformIdByTrainMapName: LINE_4_NAMES,
      },
    ]);
  });

  it("maps a neighbor by its train-map name on the map and by its Seoul name in the API", () => {
    // Arrange
    const registry = copyOf();
    registry.neighbors["S1-4-417"] = { line: "4", seoulName: "길음(동덕여대)", trainMapName: "길음" };

    // Act
    const line4 = toSeoulLines(registry)[1];

    // Assert
    expect(line4?.platformIdByApiName.get("길음(동덕여대)")).toBe("S1-4-417");
    expect(line4?.platformIdByApiName.has("길음")).toBe(false);
    expect(line4?.platformIdByTrainMapName.get("길음")).toBe("S1-4-417");
  });

  it("puts two served stations of one line on that one line", () => {
    // Arrange
    const registry = copyOf();
    const sungkyunkwan = registry.stations[0]!;
    registry.stations.push({ ...sungkyunkwan, id: "uijeongbu", seoulName: "의정부", platforms: [{ ...sungkyunkwan.platforms[0]!, id: "KR-1-X100" }] });

    // Act
    const lines = toSeoulLines(registry);

    // Assert
    expect(lines).toHaveLength(2);
    expect(lines[0]?.stationNames).toEqual(["성균관대", "의정부"]);
    expect(lines[0]?.platformIdByApiName.get("의정부")).toBe("KR-1-X100");
  });

  it("leaves out the train-map line of a line with no map", () => {
    // Arrange
    const registry = copyOf();
    delete registry.lines[1]!.seoul.trainMapLine;

    // Act
    const lines = toSeoulLines(registry);

    // Assert
    expect(lines.map((line) => line.trainMapLine)).toEqual(["1", undefined]);
  });
});

describe("toSettledObservations", () => {
  const event = (trainNo: string): TrainEvent => ({
    trainNo,
    platformId: "KR-1-0153",
    state: "arrived",
    stateChangedAt: new Date("2026-10-16T20:16:00Z"),
    destination: "광운대",
  });
  const row: CountdownRow = { trainNo: "4674", platformId: "S1-4-420", generatedAt: new Date("2026-10-16T20:16:00Z"), remainingSec: 150 };
  const answered = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
  const failed = <T>(reason: Error): PromiseSettledResult<T> => ({ status: "rejected", reason });
  const line4Down = new Error("seoul-trainmap: line 4: no train");
  const hyehwaDown = new Error("realtimeStationArrival: HTTP 500");

  it.each([
    ["no call failed", [answered([event("0493")]), answered([event("4204")])], [answered([row])], ["0493", "4204"], 1, []],
    ["one line's call failed", [answered([event("0493")]), failed<TrainEvent[]>(line4Down)], [answered([row])], ["0493"], 1, [line4Down]],
    ["every call but one failed", [answered([event("0493")]), failed<TrainEvent[]>(line4Down)], [failed<CountdownRow[]>(hyehwaDown)], ["0493"], 0, [line4Down, hyehwaDown]],
  ])("keeps what answered beside what failed when %s", (_label, eventResults, countdownResults, trainNos, rowCount, failures) => {
    // Act
    const settled = toSettledObservations("seoul-subway-api", eventResults, countdownResults);

    // Assert
    expect(settled.source).toBe("seoul-subway-api");
    expect(settled.events.map((e) => e.trainNo)).toEqual(trainNos);
    expect(settled.countdownRows).toHaveLength(rowCount);
    expect(settled.failures).toEqual(failures);
  });

  it("throws the first failure when every call failed, so nothing replaces the last good tick", () => {
    // Arrange
    const results = [failed<TrainEvent[]>(line4Down), failed<TrainEvent[]>(new Error("line 1 down"))];

    // Act & Assert
    expect(() => toSettledObservations("seoul-trainmap", results, [])).toThrow(line4Down);
  });
});
