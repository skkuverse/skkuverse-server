/**
 * The building connections (연결통로) that scripts/seed-connections.js writes,
 * and the document it writes for each once both buildings' skkuIds are looked
 * up by name. Kept apart from the script so a test can run them through the
 * server's read schema (connectionEnds in
 * src/building/catalog/building-catalog.schema.ts) without a database.
 */
const CONNECTIONS = [
  { a: "법학관",       aFloor: { ko: "2층", en: "2F" },  b: "수선관",       bFloor: { ko: "3층", en: "3F" } },
  { a: "수선관",       aFloor: { ko: "1층", en: "1F" },  b: "수선관(별관)",  bFloor: { ko: "1층", en: "1F" } },
  { a: "수선관",       aFloor: { ko: "8층", en: "8F" },  b: "수선관(별관)",  bFloor: { ko: "8층", en: "8F" } },
  { a: "수선관",       aFloor: { ko: "5층", en: "5F" },  b: "수선관(별관)",  bFloor: { ko: "5층", en: "5F" } },
  { a: "퇴계인문관",   aFloor: { ko: "2층", en: "2F" },  b: "다산경제관",   bFloor: { ko: "2층", en: "2F" } },
  { a: "다산경제관",   aFloor: { ko: "2층", en: "2F" },  b: "경영관",       bFloor: { ko: "4층", en: "4F" } },
  { a: "퇴계인문관",   aFloor: { ko: "3층", en: "3F" },  b: "다산경제관",   bFloor: { ko: "3층", en: "3F" } },
  { a: "퇴계인문관",   aFloor: { ko: "4층", en: "4F" },  b: "다산경제관",   bFloor: { ko: "4층", en: "4F" } },
  { a: "퇴계인문관",   aFloor: { ko: "5층", en: "5F" },  b: "다산경제관",   bFloor: { ko: "5층", en: "5F" } },
  { a: "다산경제관",   aFloor: { ko: "1층", en: "1F" },  b: "경영관",       bFloor: { ko: "3층", en: "3F" } },
  { a: "600주년기념관", aFloor: { ko: "지하2층", en: "B2" }, b: "국제관", bFloor: { ko: "1층", en: "1F" } },
];

/** The connection document for one row, given the skkuIds of its two ends. */
function toConnectionDoc(conn, aId, bId) {
  return {
    campus: "hssc",
    a: { skkuId: aId, floor: conn.aFloor },
    b: { skkuId: bId, floor: conn.bFloor },
  };
}

module.exports = { CONNECTIONS, toConnectionDoc };
