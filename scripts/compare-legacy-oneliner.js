#!/usr/bin/env node
/**
 * Print, for the most recent notices that carry `facts`, the one-liner and D-day a shipped app reads from the stored
 * AI summary beside the ones the server derives from the facts when the summary is missing (src/notices/legacy/).
 *
 * Usage (after `npm run build`; read-only, only `find`):
 *   node scripts/compare-legacy-oneliner.js                 # 200 notices from the _dev database
 *   node scripts/compare-legacy-oneliner.js --limit 50
 *   node scripts/compare-legacy-oneliner.js --prod          # read the production database
 *
 * Output is one JSON document on stdout: `{ now, count, rows: [{ sourceId, articleNo, title, stored, derived }] }`,
 * where `stored` and `derived` are `{ oneLiner, type, endAt, dDay }` and `dDay` is the KST day count from `now` to
 * `endAt.date` (what `formatDeadlineBadge` writes as D-n), or null. `stored` is null for a notice with no summary.
 */
const { ObjectId } = require("mongodb");
const moment = require("moment-timezone");

const args = process.argv.slice(2);
const isProd = args.includes("--prod");
if (!isProd) process.env.NODE_ENV = process.env.NODE_ENV || "development";
// WHY: src/infra/config.ts exits without these, which each execution context sets (CLAUDE.md "Environment"); this script serves nothing.
process.env.PERIMETER_MODE = process.env.PERIMETER_MODE || "local-dev";
process.env.HOST = process.env.HOST || "127.0.0.1";
const limitFlag = args.indexOf("--limit");
const LIMIT = limitFlag === -1 ? 200 : Number(args[limitFlag + 1]);
if (!Number.isInteger(LIMIT) || LIMIT < 1) throw new Error("--limit takes a positive integer");

const KST = "Asia/Seoul";
const PROJECTION = { _id: 1, sourceId: 1, articleNo: 1, title: 1, date: 1, facts: 1, factsHistory: 1, summaryAt: 1, summaryOneLiner: 1, summaryType: 1, summaryPeriods: 1, summaryVersion: 1, summaryApplication: 1, summaryDates: 1 };

function dDayOf(endAt, now) {
  if (!endAt || !endAt.date) return null;
  const today = moment(now).tz(KST).startOf("day");
  return moment.tz(endAt.date, "YYYY-MM-DD", KST).diff(today, "days");
}

function summarize(brief, now) {
  return brief && { oneLiner: brief.oneLiner, type: brief.type, endAt: brief.endAt, dDay: dDayOf(brief.endAt, now) };
}

async function main() {
  const config = require("../dist/src/infra/config");
  const { getClient, closeClient } = require("../dist/src/infra/db");
  const { Clock } = require("../dist/src/infra/clock");
  const { NoticesFactsService } = require("../dist/src/notices/facts/notices-facts.service");
  const { NoticesRowService } = require("../dist/src/notices/row/notices-row.service");
  const { NoticesLegacyService } = require("../dist/src/notices/legacy/notices-legacy.service");
  const { toSummaryBrief } = require("../dist/src/notices/list/notices-list.mapper");

  const now = new Date();
  const legacy = new NoticesLegacyService(new NoticesRowService(new NoticesFactsService({ now: () => now })));
  void Clock;
  void ObjectId;
  try {
    const collection = getClient().db(config.notices.dbName).collection(config.notices.collections.notices);
    const docs = await collection.find({ facts: { $type: "object" }, isDeleted: { $ne: true } }, { projection: PROJECTION }).sort({ date: -1, _id: -1 }).limit(LIMIT).toArray();
    const rows = docs.map((doc) => ({
      sourceId: doc.sourceId,
      articleNo: doc.articleNo,
      title: doc.title,
      stored: summarize(toSummaryBrief(doc, now), now),
      derived: summarize(legacy.deriveBrief({ ...doc, summaryAt: null }, now), now),
    }));
    process.stdout.write(`${JSON.stringify({ now: now.toISOString(), database: config.notices.dbName, count: rows.length, rows }, null, 2)}\n`);
  } finally {
    await closeClient();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
