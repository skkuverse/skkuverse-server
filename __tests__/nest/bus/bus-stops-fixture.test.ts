/**
 * Revision 1 of the `bus-stops` dataset (fixtures/bus-stops.dataset.json) is
 * the committed stop sources moved as they are (unify-bus-stops task 2.1,
 * design D1, D3 and D4): the stop catalog's stops and sequences, then one stop
 * per HSSC position that has a stop id, named from the position with its
 * trailing bracketed note removed, and the HSSC line with the settled stop ids
 * in wire order. This test is deleted with the committed files (task 4.3).
 */
import { busStopsFixture } from "../../helpers/bus/bus-stops";

const committedCatalog = require("../../../src/bus/stops/schedule-stops.json");

// WHY: HSSC_STATIONS as src/bus/config/bus-config.constants.ts held it at 98a4992b, without the unread `sequence`,
// `stationNumber` and `busType`; the constant left src/ when the HSSC group began to read the stored line.
const HSSC_STATIONS = [
  { stationName: "농구장", subtitle: "Basketball Court (Shuttle Bus Stop)", isFirstStation: true, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "학생회관", subtitle: "Student Center", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "정문", subtitle: "Main Gate of SKKU", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "올림픽기념국민생활관 [하차전용]", subtitle: "Olympic Hall [Drop-off Only]", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "혜화동우체국 [하차전용]", subtitle: "Hyehwa Postoffice [Drop-off Only]", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "혜화동로터리 [미정차]", subtitle: "Hyehwa Rotary [Non-stop]", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "혜화역 1번출구", subtitle: "Hyehwa Station (Shuttle Bus Stop)", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [{ line: "4", color: "00A5DE" }] },
  { stationName: "혜화동로터리 [미정차]", subtitle: "Hyehwa Rotary [Non-stop]", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "성균관대입구사거리", subtitle: "SKKU Junction", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "정문", subtitle: "Main Gate of SKKU", isFirstStation: false, isLastStation: false, isRotationStation: false, transferLines: [] },
  { stationName: "600주년기념관", subtitle: "600th Anniversary Hall", isFirstStation: false, isLastStation: true, isRotationStation: false, transferLines: [] },
];

// Design D1's table, by station index; the two 혜화동로터리 [미정차] positions name no stop.
const HSSC_STOP_IDS = [
  "hssc-basketball-court",
  "hssc-student-center",
  "hssc-main-gate-out",
  "hssc-olympic-hall",
  "hssc-hyehwa-post-office",
  null,
  "hssc-hyehwa-exit1",
  null,
  "hssc-skku-junction",
  "hssc-main-gate-in",
  "hssc-600th-hall",
];

const withoutNote = (label: string): string => label.replace(/\s*\[[^\]]*\]$/, "");

function projectionOfCommittedSources(): Record<string, unknown> {
  const stations = HSSC_STATIONS.map((station, index) => ({
    stopId: HSSC_STOP_IDS[index],
    name: station.stationName,
    subtitle: station.subtitle,
    isFirstStation: station.isFirstStation,
    isLastStation: station.isLastStation,
    isRotationStation: station.isRotationStation,
    transferLines: station.transferLines,
  }));
  const hsscStops = stations.flatMap((station) =>
    station.stopId === null ? [] : [{ id: station.stopId, name: { ko: withoutNote(station.name), en: withoutNote(station.subtitle) } }],
  );
  return { stops: [...committedCatalog.stops, ...hsscStops], sequences: committedCatalog.sequences, hssc: { stations } };
}

describe("the bus-stops fixture", () => {
  it("equals the committed catalog and HSSC line, with the HSSC stops and stop ids of design D1", () => {
    // Act
    const fixture = busStopsFixture();

    // Assert
    expect(fixture).toEqual(projectionOfCommittedSources());
    expect(JSON.stringify(fixture)).toBe(JSON.stringify(projectionOfCommittedSources()));
  });

  it("names nine HSSC stops, each once, and no stop for the two non-stop positions", () => {
    // Act
    const { hssc } = busStopsFixture() as { hssc: { stations: Array<{ stopId: string | null }> } };

    // Assert
    const stopIds = hssc.stations.map((station) => station.stopId);
    expect(stopIds.filter((id) => id !== null)).toHaveLength(9);
    expect(new Set(stopIds.filter((id) => id !== null)).size).toBe(9);
    expect([stopIds[5], stopIds[7]]).toEqual([null, null]);
    expect(stopIds[2]).not.toBe(stopIds[9]);
  });
});
