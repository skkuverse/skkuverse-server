import type { StationArrivals } from "./bus-station.wire";

export function toStationArrivals(stationMessage: string, hsscEta: string): StationArrivals {
  return [
    {
      busNm: "종로07",
      busSupportTime: true,
      msg1ShowMessage: true,
      msg1Message: stationMessage,
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
      msg1Message: hsscEta,
      msg1RemainStation: null,
      msg1RemainSeconds: null,
      msg2ShowMessage: true,
      msg2Message: null,
      msg2RemainStation: null,
      msg2RemainSeconds: null,
    },
  ];
}
