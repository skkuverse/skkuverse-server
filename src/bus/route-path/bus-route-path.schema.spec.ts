/**
 * The TOPIS busRouteInfo answers of Jongno 07 (add-jongro-route-lines D3): the
 * captured answers and each captured point and station pass with numbers
 * parsed from strings, a row missing any field fails at that field, a
 * non-decimal coordinate or a fractional `no` fails, and the answer envelope
 * reads the header and a null list (TOPIS's "4").
 */
import fs from "fs";
import path from "path";
import { topisRouteInfoAnswer, topisRoutePoint, topisRouteStation } from "./bus-route-path.schema";

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
