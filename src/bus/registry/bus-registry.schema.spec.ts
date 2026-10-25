/**
 * jongroRouteDocument, the parse of a stored registry document: the shape the
 * bootstrap writes passes, and a copy missing any field fails, so a hand-edited
 * document that lost one is refused where it is read. jongroRouteServiceHours,
 * the parse of a route's last-known service hours: absent passes, and a stop's
 * hours missing any field fail.
 */
import { jongroRouteDocument, jongroRouteServiceHours } from "./bus-registry.schema";

const stored = {
  _id: "jongro07",
  stations: [{ topisId: "100900220", arsId: "01504", stationName: "성균관대운동장", sequence: 1 }],
  turnaroundTopisId: "100900220",
  stationsVersion: "0123456789abcdef",
  syncedAt: new Date("2026-10-17T12:00:00Z"),
};

describe("jongroRouteDocument", () => {
  it("accepts a stored document", () => {
    // Act & Assert
    expect(jongroRouteDocument.parse(stored)).toEqual(stored);
  });

  it.each(Object.keys(jongroRouteDocument.shape))("rejects a document without %s", (field) => {
    // Arrange
    const rest = Object.fromEntries(Object.entries(stored).filter(([key]) => key !== field));

    // Act & Assert
    expect(jongroRouteDocument.safeParse(rest).success).toBe(false);
  });

  it.each(["topisId", "arsId", "stationName", "sequence"])("rejects a station without %s", (field) => {
    // Arrange
    const station = Object.fromEntries(Object.entries(stored.stations[0]!).filter(([key]) => key !== field));

    // Act & Assert
    expect(jongroRouteDocument.safeParse({ ...stored, stations: [station] }).success).toBe(false);
  });
});

describe("jongroRouteServiceHours", () => {
  const hours = { sequence: 4, firstTm: "2026-10-20T06:00:00+09:00", lastTm: "2026-10-20T22:40:00+09:00" };

  it("accepts stored hours, and a route stored before them", () => {
    // Act & Assert
    expect([jongroRouteServiceHours.parse({ serviceHours: [hours] }), jongroRouteServiceHours.parse({})]).toEqual([{ serviceHours: [hours] }, {}]);
  });

  it.each(Object.keys(hours))("rejects a stop's hours without %s", (field) => {
    // Arrange
    const rest = Object.fromEntries(Object.entries(hours).filter(([key]) => key !== field));

    // Act & Assert
    expect(jongroRouteServiceHours.safeParse({ serviceHours: [rest] }).success).toBe(false);
  });
});
