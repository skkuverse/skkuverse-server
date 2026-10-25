/**
 * The TOPIS rows of fixtures/topis-arrivals-service-hours.json (종로 08 at 19:07:50 KST and 7800 at 18:58:33 KST on
 * Sunday 2026-10-25) as BusRealtimeJongroClient reads them (its spec pins the two equal), with each row's headway and
 * its pole's first and last run. A route test that needs another day's timetables moves them to `day` (YYYY-MM-DD):
 * every date in a row moves by the same days, its times of day unchanged.
 */
import type { JongroArrivalBus, JongroArrivalDoc } from "../../../src/bus/cache/bus-cache.document";
import { toCarNumber } from "../../../src/bus/realtime/bus-realtime.mapper";
import { toBusType, toServiceHours, toTopisInteger } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.rules";
import capture from "../../nest/bus/fixtures/topis-arrivals-service-hours.json";

type CapturedRoute = "jongro08" | "gyeonggi7800";
type CapturedRow = (typeof capture.jongro08.msgBody.itemList)[number];

const CAPTURED_DAY = "2026-10-25";
const DAY_MS = 86_400_000;

function toBus(row: CapturedRow, slot: "1" | "2"): JongroArrivalBus {
  const field = (name: string): string => (row as Record<string, string>)[`${name}${slot}`]!;
  const busType = toBusType(field("busType"));
  return {
    traTime: toTopisInteger(field("traTime"))!,
    sectOrd: toTopisInteger(field("sectOrd"))!,
    staOrd: toTopisInteger(row.staOrd)!,
    arrmsg: field("arrmsg"),
    isLast: field("isLast") === "1",
    plainNo: field("plainNo"),
    vehId: field("vehId"),
    rerideDiv: toTopisInteger(field("rerdie_Div")),
    rerideNum: toTopisInteger(field("reride_Num")),
    ...(busType !== null && { busType }),
  };
}

const toCapturedDoc = (row: CapturedRow): JongroArrivalDoc => ({
  stationId: row.stId,
  sequence: row.staOrd,
  stationName: row.stNm,
  carNumber: toCarNumber(row.plainNo1),
  eventDate: row.mkTm,
  stationNumber: row.arsId,
  eta: row.arrmsg1,
  buses: [toBus(row, "1"), toBus(row, "2")],
  ...toServiceHours(row),
});

function shiftDates(text: string, days: number): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (date) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10));
}

/** The captured rows of `route` as the client reads them, on `day` when given. */
export function serviceHoursDocs(route: CapturedRoute, day = CAPTURED_DAY): JongroArrivalDoc[] {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${CAPTURED_DAY}T00:00:00Z`)) / DAY_MS);
  return capture[route].msgBody.itemList.map((row) => {
    const doc = toCapturedDoc(row);
    const moved = (text: string | undefined) => (text === undefined ? undefined : shiftDates(text, days));
    return { ...doc, eventDate: shiftDates(doc.eventDate, days), ...(doc.firstTm && { firstTm: moved(doc.firstTm) }), ...(doc.lastTm && { lastTm: moved(doc.lastTm) }) };
  });
}

/** The same rows as a poller older than the stored headway and first and last run wrote them. */
export function withoutServiceHours(docs: readonly JongroArrivalDoc[]): JongroArrivalDoc[] {
  return docs.map(({ term: _term, firstTm: _firstTm, lastTm: _lastTm, ...doc }) => doc);
}
