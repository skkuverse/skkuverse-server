// WHY: the name the Seoul API and the train map write for each upstream station, which the rows carry
// instead of an id; a served station's own name is its `seoul.stationName`.
export const SEOUL_STATION_NAME_BY_ID: Readonly<Record<string, string>> = {
  "KR-1-P150": "군포",
  "KR-1-P151": "당정",
  "KR-1-P152": "의왕",
  "KR-1-P154": "화서",
  "KR-1-P155": "수원",
  "KR-1-1715": "세류",
  "S1-4-417": "길음",
  "S1-4-418": "성신여대입구",
  "S1-4-419": "한성대입구",
  "S1-4-421": "동대문",
  "S1-4-422": "동대문역사문화공원",
  "S1-4-423": "충무로",
};

export const SEOUL_LINE_NAME_BY_SUBWAY_ID: Readonly<Record<string, string>> = {
  "1001": "1호선",
  "1004": "4호선",
};
