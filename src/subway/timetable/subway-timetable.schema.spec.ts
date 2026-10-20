/**
 * The timetable shape: a file as scripts/subway-timetable/convert.py writes it passes, a copy missing any field
 * fails, and a train number that is not four digits or a negative time fails. The `subway-timetables` header as
 * npm run data stores it: its revision and its manifest, one part id per table key.
 */
import fs from "fs";
import path from "path";
import { storedTimetableManifest, timetableFile } from "./subway-timetable.schema";

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

describe("storedTimetableManifest", () => {
  const HEADER = {
    revision: 3,
    data: {
      parts: [
        { key: "KR-1-holiday", partId: "subway-timetables/KR-1-holiday@0f3a9c1d2b4e5f60", summary: { source: { kind: "korail-xlsx" }, trainCount: 254 } },
        { key: "KR-1-weekday", partId: "subway-timetables/KR-1-weekday@9e8d7c6b5a493827", summary: { source: { kind: "korail-xlsx" }, trainCount: 270 } },
      ],
    },
  };

  it("accepts a header as npm run data stores it, keeping each table's key and part id", () => {
    // Act
    const parsed = storedTimetableManifest.safeParse(HEADER);

    // Assert
    expect(parsed.success && parsed.data).toEqual({
      revision: 3,
      data: {
        parts: [
          { key: "KR-1-holiday", partId: "subway-timetables/KR-1-holiday@0f3a9c1d2b4e5f60" },
          { key: "KR-1-weekday", partId: "subway-timetables/KR-1-weekday@9e8d7c6b5a493827" },
        ],
      },
    });
  });

  it.each([
    ["without parts", { ...HEADER, data: {} }],
    ["without revision", { data: HEADER.data }],
    ["without data", { revision: 3 }],
    ["with a part without its id", { ...HEADER, data: { parts: [{ key: "KR-1-holiday" }] } }],
    ["with a part without its key", { ...HEADER, data: { parts: [{ partId: "subway-timetables/KR-1-holiday@0f3a9c1d2b4e5f60" }] } }],
  ])("refuses a header %s", (_label, header) => {
    // Act & Assert
    expect(storedTimetableManifest.safeParse(header).success).toBe(false);
  });
});
