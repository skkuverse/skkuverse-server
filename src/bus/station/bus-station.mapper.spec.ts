/**
 * toStationArrivals lays out the two rows /bus/station/01592 serves: Jongro 07
 * with the TOPIS message, then the campus shuttle with its ETA text.
 */
import { toStationArrivals } from "./bus-station.mapper";

describe("toStationArrivals", () => {
  it("lays out the Jongro 07 row and the campus shuttle row", () => {
    // Act
    const arrivals = toStationArrivals("3분후[2번째 전]", "4 정거장 전");

    // Assert
    expect(arrivals).toEqual([
      {
        busNm: "종로07",
        busSupportTime: true,
        msg1ShowMessage: true,
        msg1Message: "3분후[2번째 전]",
        msg1RemainStation: null,
        msg1RemainSeconds: null,
        msg2ShowMessage: false,
        msg2Message: null,
        msg2RemainStation: null,
        msg2RemainSeconds: null,
      },
      {
        busNm: "인사캠셔틀",
        busSupportTime: false,
        msg1ShowMessage: true,
        msg1Message: "4 정거장 전",
        msg1RemainStation: null,
        msg1RemainSeconds: null,
        msg2ShowMessage: true,
        msg2Message: null,
        msg2RemainStation: null,
        msg2RemainSeconds: null,
      },
    ]);
  });
});
