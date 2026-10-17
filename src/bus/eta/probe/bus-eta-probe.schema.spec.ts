/**
 * The TOPIS bus position answer: the captured list and each captured bus pass, with numbers and the KST GPS time
 * parsed, and a bus missing any field fails at that field.
 */
import fs from "fs";
import path from "path";
import { topisPosition, topisPositionList } from "./bus-eta-probe.schema";

const CAPTURED: { msgBody: { itemList: Array<Record<string, unknown>> } } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../../__tests__/nest/bus/fixtures/topis-buspos-rtid-5005.json"), "utf8"),
);
const capturedBus = (): Record<string, unknown> => ({ ...CAPTURED.msgBody.itemList[0]! });

describe("topisPosition", () => {
  it("parses a captured bus: numbers from strings, and dataTm as KST wall time", () => {
    // Act
    const parsed = topisPosition.parse(capturedBus());

    // Assert
    expect(parsed).toEqual({
      vehId: "228000155",
      gpsX: 127.215442,
      gpsY: 37.228304,
      sectOrd: 6,
      dataTm: new Date("2026-10-17T03:23:11.000Z"),
    });
  });

  it("passes every captured bus", () => {
    // Act
    const results = CAPTURED.msgBody.itemList.map((bus) => topisPosition.safeParse(bus).success);

    // Assert
    expect(results).toEqual([true, true, true]);
  });

  it.each(Object.keys(topisPosition.shape))("fails a bus without %s at that field", (field) => {
    // Arrange
    const bus = capturedBus();
    delete bus[field];

    // Act
    const result = topisPosition.safeParse(bus);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it.each([
    ["dataTm", "20261317122311"],
    ["dataTm", "2026-10-17 12:23"],
    ["gpsX", ""],
    ["sectOrd", "6.5"],
  ])("fails %s %j", (field, value) => {
    // Arrange
    const bus = { ...capturedBus(), [field]: value };

    // Act
    const result = topisPosition.safeParse(bus);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});

describe("topisPositionList", () => {
  it.each([
    ["the captured list", CAPTURED],
    ["no result, with itemList null", { msgHeader: { headerCd: "4" }, msgBody: { itemList: null } }],
    ["one bus as an object, not a list", { msgHeader: { headerCd: "0" }, msgBody: { itemList: capturedBus() } }],
  ])("passes %s", (_case, body) => {
    // Act & Assert
    expect(topisPositionList.safeParse(body).success).toBe(true);
  });

  it("fails an answer with no header code", () => {
    // Act
    const result = topisPositionList.safeParse({ msgBody: { itemList: [] } });

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["msgHeader"]]);
  });
});
