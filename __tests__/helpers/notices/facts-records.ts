import fs from "fs";
import path from "path";

const FIXTURES = path.join(__dirname, "../../nest/notices/fixtures");

export type RawRecord = Record<string, any>;

/** A golden case of the crawler's row.py (__tests__/nest/notices/fixtures/facts-rows/), as the driver would hand it over; edit it, then let production parse it. */
export function goldenRecord(name: string): RawRecord {
  const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, "facts-rows", `${name}.json`), "utf8")) as { record: RawRecord };
  return stored.record;
}

/** The 40 `facts` records read from the development database on 2026-10-28, each with the notice it belongs to. */
export function devRecords(): Array<{ sourceId: string; articleNo: number; facts: RawRecord }> {
  const stored = JSON.parse(fs.readFileSync(path.join(FIXTURES, "notice-facts.dev-records.json"), "utf8")) as { records: Array<{ sourceId: string; articleNo: number; facts: RawRecord }> };
  return stored.records;
}

export const evidenceOf = (quote: string, src = "body"): RawRecord => ({ src, quote, start: 0, end: quote.length, match: "exact" });

export const actionOf = (extra: RawRecord = {}): RawRecord => ({
  verb: evidenceOf("신청하기"),
  method: "link",
  target: "K1",
  window: "",
  subjectRule: null,
  fileRule: null,
  firstCome: null,
  targetEv: null,
  track: "",
  appliesTo: [],
  tag: "",
  tagBy: "",
  ...extra,
});

export const linkOf = (id: string, url: string, text = "", src = "body"): RawRecord => ({ id, url, text, src });

export const contactOf = (extra: RawRecord = {}): RawRecord => ({ value: evidenceOf("02-760-1234"), kind: "phone", topic: "", who: "", track: "", appliesTo: [], tag: "", tagBy: "", ...extra });
