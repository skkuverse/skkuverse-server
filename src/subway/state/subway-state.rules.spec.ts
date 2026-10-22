/**
 * When a platform's arrivals document is written again: always when
 * none has been written since the process started; when any served train's number, destination, express flag,
 * arrival instant, source or position differs, a train is added or dropped in either direction, or the service
 * date changes; and otherwise once the last write is 60 s old, so a document is never served as stale while
 * the tracker runs. The documents are hand-written in the shape the tracker writes.
 */
import type { StoredTrainArrival, SubwayArrivalsDoc } from "../subway.document";
import { isArrivalsWriteDue } from "./subway-state.rules";

const JEONGJA = "DX-D1-4312";
const at = (kst: string): Date => new Date(`2026-10-19T${kst}+09:00`);

const train: StoredTrainArrival = {
  trainNo: "1031",
  destination: "광교",
  express: false,
  arrivalAt: at("21:04:10"),
  source: "estimated",
  position: { stationId: "DX-D1-4311", state: "arrived" },
};

function doc(generatedKst: string, change: Partial<SubwayArrivalsDoc> = {}): SubwayArrivalsDoc {
  return { _id: JEONGJA, generatedAt: at(generatedKst), serviceDate: "2026-10-19", directions: { up: [], down: [train] }, ...change };
}

const LAST = doc("21:03:10");

describe("isArrivalsWriteDue", () => {
  it("writes a platform no write has been remembered for, as after a restart", () => {
    // Act & Assert
    expect(isArrivalsWriteDue(undefined, doc("21:03:10"))).toBe(true);
  });

  it.each([
    ["59 s after the last write", "21:04:09", false],
    ["60 s after the last write", "21:04:10", true],
    ["61 s after the last write", "21:04:11", true],
  ])("with the same trains, %s (%s KST): writes %s", (_label, generatedKst, due) => {
    // Act & Assert
    expect(isArrivalsWriteDue(LAST, doc(generatedKst))).toBe(due);
  });

  it.each<[string, Partial<StoredTrainArrival>]>([
    ["trainNo", { trainNo: "1033" }],
    ["destination", { destination: "정자" }],
    ["express", { express: true }],
    ["arrivalAt", { arrivalAt: at("21:04:11") }],
    ["source", { source: "scheduled" }],
    ["position's station", { position: { stationId: JEONGJA, state: "arrived" } }],
    ["position's state", { position: { stationId: "DX-D1-4311", state: "departed" } }],
    ["position, gone", { position: null }],
  ])("writes 20 s on when a train's %s changed", (_field, trainChange) => {
    // Arrange
    const next = doc("21:03:30", { directions: { up: [], down: [{ ...train, ...trainChange }] } });

    // Act & Assert
    expect(isArrivalsWriteDue(LAST, next)).toBe(true);
  });

  it("writes 20 s on when a train's position appears where there was none", () => {
    // Arrange
    const last = doc("21:03:10", { directions: { up: [], down: [{ ...train, position: null }] } });

    // Act & Assert
    expect(isArrivalsWriteDue(last, doc("21:03:30"))).toBe(true);
  });

  it.each<[string, SubwayArrivalsDoc["directions"]]>([
    ["a train is added up", { up: [train], down: [train] }],
    ["the down train is dropped", { up: [], down: [] }],
    ["a second train follows down", { up: [], down: [train, { ...train, trainNo: "1033" }] }],
  ])("writes 20 s on when %s", (_label, directions) => {
    // Act & Assert
    expect(isArrivalsWriteDue(LAST, doc("21:03:30", { directions }))).toBe(true);
  });

  it("writes 20 s on when the service date changes, its trains alike", () => {
    // Act & Assert
    expect(isArrivalsWriteDue(LAST, doc("21:03:30", { serviceDate: "2026-10-20" }))).toBe(true);
  });

  it("does not write 20 s on when the trains are equal but newly built", () => {
    // Arrange
    const next = doc("21:03:30", { directions: { up: [], down: [{ ...train, arrivalAt: at("21:04:10"), position: { stationId: "DX-D1-4311", state: "arrived" } }] } });

    // Act & Assert
    expect(isArrivalsWriteDue(LAST, next)).toBe(false);
  });
});
