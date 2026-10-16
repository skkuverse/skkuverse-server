/**
 * The committed timetable file shape: a file as scripts/subway-timetable/convert.py writes it passes, a copy
 * missing any field fails, and a train number that is not four digits or a negative time fails.
 */
import fs from "fs";
import path from "path";
import { timetableFile } from "./subway-timetable.schema";

const COMMITTED = JSON.parse(fs.readFileSync(path.join(__dirname, "korail-1-weekday.json"), "utf8")) as Record<string, unknown>;

const TRAIN = {
  trainNo: "0493",
  direction: "down",
  destination: "서동탄",
  express: false,
  stops: [{ station: "KR-1-0153", arr: 74460, dep: 74490 }],
};

const FILE = { ...COMMITTED, trains: [TRAIN] };

describe("timetableFile", () => {
  it("accepts a committed file as the script writes it", () => {
    // Act & Assert
    expect(timetableFile.safeParse(COMMITTED).success).toBe(true);
  });

  it.each(Object.keys(timetableFile.shape))("rejects a file without %s", (field) => {
    // Arrange
    const copy = Object.fromEntries(Object.entries(FILE).filter(([key]) => key !== field));

    // Act & Assert
    expect(timetableFile.safeParse(copy).success).toBe(false);
  });

  it.each(Object.keys(TRAIN))("rejects a train without %s", (field) => {
    // Arrange
    const train = Object.fromEntries(Object.entries(TRAIN).filter(([key]) => key !== field));

    // Act & Assert
    expect(timetableFile.safeParse({ ...FILE, trains: [train] }).success).toBe(false);
  });

  it.each([
    ["a train number with its prefix", { ...TRAIN, trainNo: "K0493" }],
    ["a three-digit train number", { ...TRAIN, trainNo: "493" }],
    ["a negative time", { ...TRAIN, stops: [{ station: "KR-1-0153", arr: -30, dep: 74490 }] }],
    ["a train without stops", { ...TRAIN, stops: [] }],
  ])("rejects %s", (_label, train) => {
    // Act & Assert
    expect(timetableFile.safeParse({ ...FILE, trains: [train] }).success).toBe(false);
  });
});
