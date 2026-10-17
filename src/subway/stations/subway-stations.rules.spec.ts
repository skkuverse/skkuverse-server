/**
 * A served station as other modules read it: its title is its name with the
 * station suffix each language writes (a space before it in English only), and
 * its line carries the label and the color the operator gives it. A station on
 * a line with neither throws, so it fails the boot instead of drawing a blank
 * icon or an untranslated label.
 */
import { SUBWAY_STATIONS } from "../subway.constants";
import type { SubwayStation } from "../subway.types";
import { toServedStation } from "./subway-stations.rules";

const [sungkyunkwan, hyehwa] = SUBWAY_STATIONS as [SubwayStation, SubwayStation];

describe("toServedStation", () => {
  it("titles Hyehwa with the suffix and labels and paints line 4", () => {
    // Act
    const served = toServedStation(hyehwa);

    // Assert
    expect(served).toEqual({
      id: "S1-4-420",
      title: { ko: "혜화역", en: "Hyehwa Station", zh: "惠化站" },
      lineCode: "4",
      lineLabel: { ko: "4호선", en: "Line 4", zh: "4号线" },
      lineColor: "00A5DE",
    });
  });

  it("titles Sungkyunkwan Univ. with the suffix and labels and paints line 1", () => {
    // Act
    const served = toServedStation(sungkyunkwan);

    // Assert
    expect(served).toEqual({
      id: "KR-1-0153",
      title: { ko: "성균관대역", en: "Sungkyunkwan Univ. Station", zh: "成均馆大学站" },
      lineCode: "1",
      lineLabel: { ko: "1호선", en: "Line 1", zh: "1号线" },
      lineColor: "0052A4",
    });
  });

  it.each(["2", "", "01"])("throws on a station on line %j, which has no label or color", (lineCode) => {
    // Arrange
    const unknownLine = { ...hyehwa, lineCode };

    // Act & Assert
    expect(() => toServedStation(unknownLine)).toThrow(/line/);
  });
});
