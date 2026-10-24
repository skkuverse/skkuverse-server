/**
 * A served station as GET /subway/stations lists it: its slug, its title and
 * each line's name and marker text in the request language, its campus, the
 * line codes and colors as they are, and its coords, null when the server has
 * none.
 */
import type { ServedStation } from "../stations/subway-stations.types";
import { toListedStation } from "./subway-station-list.mapper";

const JEONGJA: ServedStation = {
  id: "jeongja",
  title: { ko: "정자역", en: "Jeongja Station", zh: "亭子站" },
  campus: "nsc",
  lines: [
    { code: "D1", name: { ko: "신분당선", en: "Shinbundang Line", zh: "新盆唐线" }, color: "D4003B", marker: { text: { ko: "신", en: "신", zh: "新" }, color: "D4003B" } },
    { code: "K1", name: { ko: "수인분당선", en: "Suin–Bundang Line", zh: "水仁·盆唐线" }, color: "F5A200", marker: { text: { ko: "수", en: "수", zh: "水" }, color: "A26B00" } },
  ],
};

describe("toListedStation", () => {
  it("lists a transfer station in the request language with its coords", () => {
    // Act
    const listed = toListedStation(JEONGJA, { lat: 37.366546, lng: 127.108237 }, "zh");

    // Assert
    expect(listed).toEqual({
      id: "jeongja",
      title: "亭子站",
      campus: "nsc",
      lines: [
        { code: "D1", name: "新盆唐线", color: "D4003B", marker: { text: "新", color: "D4003B" } },
        { code: "K1", name: "水仁·盆唐线", color: "F5A200", marker: { text: "水", color: "A26B00" } },
      ],
      coords: { lat: 37.366546, lng: 127.108237 },
    });
  });

  it("lists a station without coords with null coords and its lines", () => {
    // Act
    const listed = toListedStation(JEONGJA, null, "ko");

    // Assert
    expect(listed).toEqual({
      id: "jeongja",
      title: "정자역",
      campus: "nsc",
      lines: [
        { code: "D1", name: "신분당선", color: "D4003B", marker: { text: "신", color: "D4003B" } },
        { code: "K1", name: "수인분당선", color: "F5A200", marker: { text: "수", color: "A26B00" } },
      ],
      coords: null,
    });
  });
});
