/**
 * toHsscEta turns HSSC shuttle positions into the ETA text for one stop on the
 * campus shuttle line. BusStationService serves the Hyehwa boarding stop's result
 * (sequence 6) on /bus/station/01592; the terminal branch only matters for sequence 10.
 *
 * A bus counts while its sequence is at or before the stop. The closest such
 * bus answers with its stop count, or, when it sits at the stop, with
 * "arriving" while it has been there under 60 s; after that it is stale and
 * the bus behind it answers instead.
 */

import { HSSC_STATIONS } from "./bus-station.constants";
import { toHsscEta, withHsscEtas } from "./bus-station.rules";

type Station = Parameters<typeof toHsscEta>[0];
type Bus = NonNullable<Parameters<typeof toHsscEta>[1]>[number];

const NO_INFO = "도착 정보 없음";
const ARRIVING = "도착 또는 출발";
const stopsAway = (n: number): string => `${n} 정거장 전`;

function stationAt(sequence: number): Station {
  const station = HSSC_STATIONS.find((s) => s.sequence === sequence);
  if (!station) throw new Error(`no HSSC stop with sequence ${sequence}`);
  return station;
}

const HYEHWA = stationAt(6);
const TERMINAL = stationAt(10);

// One row of the HSSC poller's output (BusRealtimeHsscService). toHsscEta reads
// only `sequence` (a string) and `estimatedTime` (seconds since the bus
// reached that stop).
function busAt(sequence: number, overrides: Partial<Bus> = {}): Bus {
  return {
    sequence: String(sequence),
    stationName: stationAt(sequence).stationName,
    carNumber: "0000",
    eventDate: "2026-10-08 09:00:00",
    estimatedTime: 30,
    isLastBus: false,
    ...overrides,
  };
}

describe("toHsscEta", () => {
  describe("no bus to report", () => {
    it("reports no info when no bus is running", () => {
      // Act
      const result = toHsscEta(HYEHWA, []);

      // Assert
      expect(result).toBe(NO_INFO);
    });

    it("reports no info when every bus has passed the stop", () => {
      // Arrange
      const buses = [busAt(7), busAt(9)];

      // Act
      const result = toHsscEta(HYEHWA, buses);

      // Assert
      expect(result).toBe(NO_INFO);
    });
  });

  describe("a bus before the stop", () => {
    it.each([
      { sequence: 5, expected: stopsAway(1) },
      { sequence: 3, expected: stopsAway(3) },
      { sequence: 1, expected: stopsAway(5) },
    ])(
      "counts $expected for a bus at sequence $sequence",
      ({ sequence, expected }) => {
        // Act
        const result = toHsscEta(HYEHWA, [busAt(sequence)]);

        // Assert
        expect(result).toBe(expected);
      },
    );

    it("counts from the closest bus before the stop, whatever the input order", () => {
      // Arrange
      const buses = [busAt(2), busAt(8), busAt(4), busAt(1)];

      // Act
      const result = toHsscEta(HYEHWA, buses);

      // Assert
      expect(result).toBe(stopsAway(2));
    });

    it("ignores a bus whose sequence is not a number", () => {
      // Arrange
      const buses = [busAt(5, { sequence: "NaN" }), busAt(3)];

      // Act
      const result = toHsscEta(HYEHWA, buses);

      // Assert
      expect(result).toBe(stopsAway(3));
    });
  });

  describe("a bus at the stop", () => {
    it.each([0, 30, 59])(
      "reports arriving when the bus has been at the stop for %i s",
      (estimatedTime) => {
        // Arrange
        const buses = [busAt(6, { estimatedTime }), busAt(4)];

        // Act
        const result = toHsscEta(HYEHWA, buses);

        // Assert
        expect(result).toBe(ARRIVING);
      },
    );

    it.each([60, 600])(
      "treats a bus at the stop for %i s as stale and counts from the bus behind it",
      (estimatedTime) => {
        // Arrange
        const buses = [busAt(6, { estimatedTime }), busAt(4)];

        // Act
        const result = toHsscEta(HYEHWA, buses);

        // Assert
        expect(result).toBe(stopsAway(2));
      },
    );

    it("reports no info when a stale bus at the stop has no bus behind it", () => {
      // Arrange
      const buses = [busAt(6, { estimatedTime: 120 })];

      // Act
      const result = toHsscEta(HYEHWA, buses);

      // Assert
      expect(result).toBe(NO_INFO);
    });

    it.each([undefined, NaN])(
      "treats a bus at the stop with estimatedTime %p as stale",
      (estimatedTime) => {
        // Arrange
        const buses = [busAt(6, { estimatedTime }), busAt(4)];

        // Act
        const result = toHsscEta(HYEHWA, buses);

        // Assert
        expect(result).toBe(stopsAway(2));
      },
    );

    // Current behavior, not a contract: `null < 60` is true in JS, so a null
    // estimatedTime reads as 0 s, while undefined and NaN (above) read as stale.
    it("reports arriving for a bus at the stop with a null estimatedTime", () => {
      // Arrange
      const buses = [
        busAt(6, { estimatedTime: null as unknown as number }),
        busAt(4),
      ];

      // Act
      const result = toHsscEta(HYEHWA, buses);

      // Assert
      expect(result).toBe(ARRIVING);
    });

    // Current behavior, not a contract: the fallback takes the next bus without
    // checking where it is or how long it has waited, so a second bus at the
    // same stop answers "0 stops away", and the answer depends on input order.
    it.each([
      {
        order: "stale bus first",
        buses: [busAt(6, { estimatedTime: 120 }), busAt(6, { estimatedTime: 10 })],
        expected: stopsAway(0),
      },
      {
        order: "fresh bus first",
        buses: [busAt(6, { estimatedTime: 10 }), busAt(6, { estimatedTime: 120 })],
        expected: ARRIVING,
      },
    ])(
      "answers two buses at the stop by input order: $order gives $expected",
      ({ buses, expected }) => {
        // Act
        const result = toHsscEta(HYEHWA, buses);

        // Assert
        expect(result).toBe(expected);
      },
    );
  });

  describe("a stale bus at the terminal (sequence 10)", () => {
    const stale = busAt(10, { estimatedTime: 120 });

    it.each([
      {
        behavior: "skips a second bus parked at the terminal and counts from the one behind it",
        buses: [stale, busAt(10, { estimatedTime: 300 }), busAt(7)],
        expected: stopsAway(3),
      },
      {
        behavior: "reports no info when only parked buses sit at the terminal",
        buses: [stale, busAt(10, { estimatedTime: 300 })],
        expected: NO_INFO,
      },
      {
        behavior: "counts from the next bus when it is not at the terminal",
        buses: [stale, busAt(8)],
        expected: stopsAway(2),
      },
      // Current behavior, not a contract: only one parked bus is skipped, so a
      // third bus at the terminal answers "0 stops away".
      {
        behavior: "counts a third bus at the terminal as 0 stops away",
        buses: [stale, busAt(10, { estimatedTime: 300 }), busAt(10, { estimatedTime: 400 })],
        expected: stopsAway(0),
      },
    ])("$behavior", ({ buses, expected }) => {
      // Act
      const result = toHsscEta(TERMINAL, buses);

      // Assert
      expect(result).toBe(expected);
    });
  });
});

describe("withHsscEtas", () => {
  it("gives every station its ETA in a new array, leaving the stations as they were", () => {
    // Arrange
    const buses = [busAt(4)];

    // Act
    const stations = withHsscEtas(HSSC_STATIONS, buses);

    // Assert
    expect(stations.map((s) => s.eta)).toEqual([
      NO_INFO, NO_INFO, NO_INFO, ARRIVING, stopsAway(1), stopsAway(2), stopsAway(3), stopsAway(4), stopsAway(5), stopsAway(6),
    ]);
    expect(HSSC_STATIONS.every((s) => s.eta === NO_INFO)).toBe(true);
  });
});
