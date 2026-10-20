/**
 * A served station as other modules read it: its slug, its title (its name
 * with the station suffix each language writes, a space before it in English
 * only) and, in its platforms' order, each line's code, name, color and marker
 * from the code's lines, whose spec refuses a platform on an unlisted line.
 */
import { SUBWAY_STATIONS } from "../subway.constants";
import { toSubwayLine } from "../subway.rules";
import type { NetworkStation, SubwayLine } from "../subway.types";
import { toServedStation } from "./subway-stations.rules";

const stationOf = (slug: string) => SUBWAY_STATIONS.find((station) => station.id === slug) as NetworkStation;
const lineOf = (code: string): SubwayLine => toSubwayLine(code);

describe("toServedStation", () => {
  it("titles Hyehwa with the suffix and lists line 4 with its name, color and marker", () => {
    // Act
    const served = toServedStation(stationOf("hyehwa"), lineOf);

    // Assert
    expect(served).toEqual({
      id: "hyehwa",
      title: { ko: "혜화역", en: "Hyehwa Station", zh: "惠化站" },
      lines: [{ code: "4", name: { ko: "4호선", en: "Line 4", zh: "4号线" }, color: "00A5DE", marker: { text: { ko: "4", en: "4", zh: "4" }, color: "007FAB" } }],
    });
  });

  it("titles Sungkyunkwan Univ. with the suffix and lists line 1", () => {
    // Act
    const served = toServedStation(stationOf("sungkyunkwan"), lineOf);

    // Assert
    expect(served).toEqual({
      id: "sungkyunkwan",
      title: { ko: "성균관대역", en: "Sungkyunkwan Univ. Station", zh: "成均馆大学站" },
      lines: [{ code: "1", name: { ko: "1호선", en: "Line 1", zh: "1号线" }, color: "0052A4", marker: { text: { ko: "1", en: "1", zh: "1" }, color: "0052A4" } }],
    });
  });

  it("lists a transfer station's lines in its platforms' order", () => {
    // Arrange
    const hyehwa = stationOf("hyehwa");
    const sungkyunkwan = stationOf("sungkyunkwan");
    const transfer: NetworkStation = { ...hyehwa, id: "transfer", platforms: [...hyehwa.platforms, ...sungkyunkwan.platforms] };

    // Act
    const served = toServedStation(transfer, lineOf);

    // Assert
    expect(served.lines.map((line) => [line.code, line.marker.text.en, line.color])).toEqual([
      ["4", "4", "00A5DE"],
      ["1", "1", "0052A4"],
    ]);
  });
});
