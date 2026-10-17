/**
 * jongroRouteDocument, the parse of a stored registry document: the shape the
 * seed writes passes, and a copy missing any field fails, so a hand-edited
 * document that lost one is refused where it is read.
 */
import { jongroRouteDocument } from "./bus-registry.schema";

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
