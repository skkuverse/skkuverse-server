/**
 * The TOPIS busRouteInfo answers of Jongno 07: the
 * captured answers and each captured point and station pass with numbers
 * parsed from strings, a row missing any field fails at that field, a
 * non-decimal coordinate or a fractional `no` fails, and the answer envelope
 * reads the header and a null list (TOPIS's "4"). A station row also keeps its
 * `direction`, the terminal TOPIS says the bus heads to there, which flips at the
 * station after the turnaround; a row without one, or a blank one, says nothing
 * (null), and one that is not text fails the row.
 */
import fs from "fs";
import path from "path";
import { topisRouteInfoAnswer, topisRoutePoint, topisRouteStation, topisRouteStationRow } from "./bus-route-path.schema";

type Answer = { msgBody: { itemList: Array<Record<string, unknown>> } };
const read = (name: string): Answer => JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures", name), "utf8"));
const PATH_ANSWER = read("topis-route-path-jongro07.json");
const STATIONS_ANSWER = read("topis-route-stations-jongro07.json");

describe("topisRoutePoint", () => {
  it("parses a captured point's number and coordinates from strings", () => {
    // Act
    const parsed = topisRoutePoint.parse(PATH_ANSWER.msgBody.itemList[0]);

    // Assert
    expect(parsed).toEqual({ no: 1, gpsX: 126.9921543446, gpsY: 37.5881571127 });
  });

  it("passes every captured point", () => {
    // Act & Assert
    expect(PATH_ANSWER.msgBody.itemList.every((point) => topisRoutePoint.safeParse(point).success)).toBe(true);
  });

  it.each(Object.keys(topisRoutePoint.shape))("fails a point without %s at that field", (field) => {
    // Arrange
    const point = { ...PATH_ANSWER.msgBody.itemList[0]! };
    delete point[field];

    // Act & Assert
    expect(topisRoutePoint.safeParse(point).error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it.each([
    ["gpsX", ""],
    ["gpsY", "37.58N"],
    ["no", "1.5"],
  ])("fails %s %j", (field, value) => {
    // Act & Assert
    expect(topisRoutePoint.safeParse({ ...PATH_ANSWER.msgBody.itemList[0], [field]: value }).success).toBe(false);
  });
});

describe("topisRouteStation", () => {
  it("parses the captured turnaround station", () => {
    // Act
    const parsed = topisRouteStation.parse(STATIONS_ANSWER.msgBody.itemList[2]);

    // Assert
    expect(parsed).toEqual({ station: "100900028", arsId: expect.any(String), stationNm: "방송통신대앞", seq: 13, gpsX: expect.any(Number), gpsY: expect.any(Number), transYn: "Y" });
  });

  it("passes every captured station, the one whose times read \":\" included", () => {
    // Act & Assert
    expect(STATIONS_ANSWER.msgBody.itemList.every((station) => topisRouteStation.safeParse(station).success)).toBe(true);
  });

  it.each(Object.keys(topisRouteStation.shape))("fails a station without %s at that field", (field) => {
    // Arrange
    const station = { ...STATIONS_ANSWER.msgBody.itemList[0]! };
    delete station[field];

    // Act & Assert
    expect(topisRouteStation.safeParse(station).error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});

describe("topisRouteStationRow", () => {
  it("keeps each captured station's direction: the outbound terminal up to the turnaround, the inbound one after it", () => {
    // Act
    const directions = STATIONS_ANSWER.msgBody.itemList.map((row) => [topisRouteStationRow.parse(row).seq, topisRouteStationRow.parse(row).direction]);

    // Assert
    expect(directions).toEqual([
      [1, "이화사거리"],
      [2, "이화사거리"],
      [13, "이화사거리"],
      [22, "성균관대운동장"],
    ]);
  });

  it.each([
    ["without the field", undefined],
    ["with null", null],
    ["with an empty one", ""],
    ["with a blank one", "  "],
  ])("reads a row %s as no direction, keeping the station", (_label, direction) => {
    // Arrange
    const row: Record<string, unknown> = { ...STATIONS_ANSWER.msgBody.itemList[0]!, direction };
    if (direction === undefined) delete row.direction;

    // Act
    const parsed = topisRouteStationRow.safeParse(row);

    // Assert
    expect(parsed.data).toMatchObject({ station: "100900220", direction: null });
  });

  it("trims the direction and fails a row whose direction is not text", () => {
    // Act
    const padded = topisRouteStationRow.parse({ ...STATIONS_ANSWER.msgBody.itemList[0], direction: " 이화사거리 " });
    const numeric = topisRouteStationRow.safeParse({ ...STATIONS_ANSWER.msgBody.itemList[0], direction: 7 });

    // Assert
    expect(padded.direction).toBe("이화사거리");
    expect(numeric.error?.issues.map((issue) => issue.path)).toEqual([["direction"]]);
  });
});

describe("topisRouteInfoAnswer", () => {
  it("reads the captured header and list", () => {
    // Act
    const parsed = topisRouteInfoAnswer.parse(PATH_ANSWER);

    // Assert
    expect(parsed.msgHeader.headerCd).toBe("0");
    expect(parsed.msgBody?.itemList).toHaveLength(12);
  });

  it('reads a "no result" answer, whose list is null, and fails one without a header', () => {
    // Act
    const noResult = topisRouteInfoAnswer.safeParse({ msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } });
    const foreign = topisRouteInfoAnswer.safeParse({ error: "Unauthorized" });

    // Assert
    expect(noResult.success).toBe(true);
    expect(foreign.success).toBe(false);
  });
});
