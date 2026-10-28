/**
 * The list row of the umbrella repository's ADR 0009 (notice list rows, D3 to D9, as amended 2026-10-27 and 2026-10-28)
 * from a parsed facts record at a KST moment: its status token, title, line 2, qualifier, date mark, dimming and urgency.
 *
 * The crawler's row.py is the reference: every golden case it dumps (__tests__/nest/notices/fixtures/facts-rows/, refreshed
 * by scripts/sync-facts-row-fixtures.js) renders here as row.py rendered it, unless the ADR says otherwise. Each such case
 * sits in OVERRIDES with the ADR line it follows. The cases after the golden run cover what no golden case reaches: every
 * D3 token, the D4 line kinds the port changes, the dim rules, and the KST midnight.
 *
 * Records reach the rules only through NoticesFactsService.parseFacts, as in production. src/infra/logger.ts is mocked.
 */
import fs from "fs";
import path from "path";
import { ObjectId } from "mongodb";
import type { Clock } from "../../infra/clock";

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import type { NoticeFacts } from "../facts/notices-facts.schema";
import { NoticesFactsService } from "../facts/notices-facts.service";
import type { FactsSnapshot } from "../notices.document";
import { toFactsRow, toFactsRows } from "./notices-row.rules";
import type { FactsRow, RowSource, RowTokenTone } from "./notices-row.types";

const FIXTURES = path.join(__dirname, "../../../__tests__/nest/notices/fixtures/facts-rows");
const ORIGINAL_TITLE = "2026학년도 2학기 장학금 신청 안내";
const NOTICE_ID = new ObjectId("6a5ed9e520097db8672d2097");
const FIXED_CLOCK: Clock = { now: () => new Date("2026-10-28T03:00:00Z") };
const facts = new NoticesFactsService(FIXED_CLOCK);

interface RowPyRow {
  token: string;
  title: string;
  line2: string;
  qual: [string, string];
  status: string;
  item: string;
  titleFallback: boolean;
  warnings: string[];
}

interface GoldenCase {
  case: string;
  recordFrom: "build" | "hand";
  now: string;
  record: Record<string, unknown>;
  expected: RowPyRow;
}

const GOLDEN_CASES: Array<[string, GoldenCase]> = fs
  .readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => [name, JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as GoldenCase]);

const goldenCase = (name: string): GoldenCase => GOLDEN_CASES.find(([file]) => file === `${name}.json`)![1];

// row.py writes its today token only for a deadline today, so that token is the urgent one.
const ROW_PY_TONES: Record<string, RowTokenTone> = {
  취소: "cancelled",
  마감: "closed",
  중단: "stopped",
  연장: "extended",
  오늘: "urgent",
  "내일 마감": "urgent",
};

/** row.py's row in this port's shape. Dimming and urgency are ADR 0009 D3 and D4 applied to row.py's status and token. */
function fromRowPy({ expected, record }: GoldenCase): FactsRow {
  const shortTitle = record.shortTitle as { text: string };
  const abstains = expected.status === "check";
  const warned = expected.warnings.length > 0 ? "warning" : null;
  return {
    token: expected.token ? { text: expected.token, tone: ROW_PY_TONES[expected.token]! } : null,
    title: expected.titleFallback && expected.title === shortTitle.text ? ORIGINAL_TITLE : expected.title,
    line2: expected.line2,
    qualifier: expected.qual[0] === "none" ? null : expected.qual[1],
    dateMark: abstains ? "abstain" : warned,
    dimmed: ["closed", "ended", "cancelled"].includes(expected.status) || expected.qual[0] === "notForStudents",
    urgent: expected.token === "오늘" || expected.token === "내일 마감",
    status: abstains ? "abstain" : (expected.status as FactsRow["status"]),
    itemId: expected.item || null,
  };
}

const ABSTAINS = "ADR 0009 D4: a row that abstains replaces its date with 날짜 원문 확인";
const TOMORROW_DEADLINE = "ADR 0009 D4: a deadline within two days reads 오늘 17시 마감, 내일 마감";
const STOPPED = "ADR 0009 D4: line 2 opens with a date, and a slot with no date stays empty; D3: the token carries the word, so a cancelled call's sign-up window shows none";

/** Golden cases where ADR 0009 overrides row.py: the fields that differ, and the ADR line each follows. */
const OVERRIDES: Record<string, { adr: string; row: Partial<FactsRow> }> = {
  "a_period_with_no_end_written_is_that_one_day__1.json": {
    adr: "ADR 0009 D3: 오늘 when the deadline or event is today; D4: an event today takes the token but not the colour; relative words in line 2",
    row: { token: { text: "오늘", tone: "today" }, line2: "오늘" },
  },
  "a_bounded_period_under_way_comes_before_what_takes_effect_after_it.json": {
    adr: "ADR 0009 D4: relative words (today, tomorrow) are computed when the list is shown",
    row: { line2: "오늘까지 해제" },
  },
  "a_deadline_tomorrow_reads_as_one_while_the_window_is_open.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감" } },
  "a_mistyped_years_window_yields_to_the_same_deadline_written_correctly.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감" } },
  "the_place_qualifier_comes_from_the_item_the_row_shows__1.json": { adr: TOMORROW_DEADLINE, row: { line2: "내일 마감" } },
  "an_office_deadline_does_not_open_the_row.json": {
    adr: "ADR 0009 D4: not open yet reads 내일 접수 시작 · 11/9(월) 마감",
    row: { line2: "내일 접수 시작 · 11/13(금) 마감" },
  },
  "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__1.json": { adr: STOPPED, row: { line2: "" } },
  "a_stopped_or_filled_notice_keeps_its_token_on_the_last_days__2.json": { adr: STOPPED, row: { line2: "" } },
  "a_date_code_had_to_guess_is_shown_as_written_to_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인" } },
  "a_date_the_check_dropped_is_shown_as_written_to_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인" } },
  "a_row_abstains_when_its_only_deadline_was_dropped_by_the_date_check.json": { adr: ABSTAINS, row: { line2: "날짜 원문 확인" } },
};

/** Hand-edited golden cases whose record the schema refuses, so no production read could reach the rules with them. */
const UNPARSED: Record<string, string> = {
  "unattached_facts_never_reach_the_row.json": "the test hand-writes a benefit with no `track`, `appliesTo`, `tag` or `ev.match`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__1.json": "the test sets `rowCheck` without `read`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__2.json": "the test sets `rowCheck` without `read`; covered below",
  "when_the_second_read_disagrees_the_row_is_less_specific__3.json": "the test sets `rowCheck` without `read`; covered below",
};

const kstNoon = (day: string): Date => new Date(`${day}T03:00:00Z`);

function parsed(record: unknown): NoticeFacts {
  const out = facts.parseFacts(record, NOTICE_ID);
  if (out === null) throw new Error("the test record does not parse as facts");
  return out;
}

/** A golden case's record, changed by `edit`, then parsed as production parses it. */
function recordFrom(name: string, edit: (record: any) => void = () => undefined): NoticeFacts {
  const record = structuredClone(goldenCase(name).record);
  edit(record);
  return parsed(record);
}

const sourceOf = (record: NoticeFacts, factsHistory: FactsSnapshot[] = []): RowSource => ({ facts: record, factsHistory, title: ORIGINAL_TITLE });

const WINDOW = "a_deadline_tomorrow_reads_as_one_while_the_window_is_open";
const SESSION = "the_place_qualifier_comes_from_the_item_the_row_shows__2";
const STAFF = "not_for_students_needs_a_quote__2";
const MAIN_THING = "th_441ff75112a0";

const statement = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  thing: MAIN_THING,
  ev: { src: "body", quote: "※ 공지", start: 0, end: 4, match: "exact" },
  tag: "",
  tagBy: "",
  ...extra,
});

describe("toFactsRow, the crawler's golden cases", () => {
  it("leaves out only the hand-edited cases the schema refuses", () => {
    // Arrange
    const refused = GOLDEN_CASES.filter(([, fixture]) => facts.parseFacts(fixture.record, NOTICE_ID) === null).map(([name]) => name);

    // Assert
    expect(GOLDEN_CASES).toHaveLength(51);
    expect(refused).toEqual(Object.keys(UNPARSED).sort());
  });

  it.each(GOLDEN_CASES.filter(([name]) => !(name in UNPARSED)))("renders %s as row.py, or as ADR 0009 overrides it", (name, fixture) => {
    // Arrange
    const expected = { ...fromRowPy(fixture), ...OVERRIDES[name]?.row };

    // Act
    const row = toFactsRow(sourceOf(parsed(fixture.record)), kstNoon(fixture.now));

    // Assert
    expect(row).toEqual(expected);
  });

  it("lists only overrides that change what row.py rendered", () => {
    // Arrange
    const unchanged = Object.entries(OVERRIDES).filter(([name, { row }]) =>
      Object.entries(row).every(([field, value]) => JSON.stringify(fromRowPy(goldenCase(name.replace(/\.json$/, "")))[field as keyof FactsRow]) === JSON.stringify(value)),
    );

    // Assert
    expect(unchanged.map(([name]) => name)).toEqual([]);
  });
});

describe("toFactsRow, the D3 token precedence", () => {
  it.each<[string, () => NoticeFacts, string, RowTokenTone | null, Partial<FactsRow>]>([
    ["취소 on a cancelled main thing, even on its deadline day", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-26", "cancelled", { line2: "", dimmed: true, urgent: false, itemId: null }],
    ["취소 over 오늘 on a cancelled event today, which keeps its date", () => recordFrom(SESSION, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-29", "cancelled", { line2: "오늘", dimmed: true, itemId: "tm_f93f22c01563" }],
    ["오늘 on a deadline today, in the urgency colour", () => recordFrom(WINDOW), "2026-10-26", "urgent", { line2: "오늘 마감", urgent: true, dimmed: false }],
    ["오늘 on an event today, without the colour", () => recordFrom(SESSION), "2026-10-29", "today", { line2: "오늘", urgent: false, status: "today" }],
    ["내일 마감 on a deadline tomorrow", () => recordFrom(WINDOW), "2026-10-25", "urgent", { line2: "내일 마감", urgent: true }],
    ["마감 once the deadline has passed", () => recordFrom(WINDOW), "2026-10-27", "closed", { line2: "10/26(월) 마감됨", dimmed: true }],
    ["마감, not 오늘, for a call stated full on its deadline day", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("quotaFilled"))), "2026-10-26", "closed", { urgent: false, dimmed: true }],
    ["중단 on a suspended main thing, not dimmed", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22", "stopped", { line2: "", dimmed: false }],
    ["마감 over 중단 once the suspended call's deadline has passed", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-27", "closed", { status: "closed" }],
    ["연기 on a postponed main thing, with the date it had", () => recordFrom(SESSION, (r) => r.statusStatements.push(statement("postponed"))), "2026-10-25", "postponed", { line2: "10/29(목)", dimmed: false }],
    ["연장 on an extended deadline still open", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("extended"))), "2026-10-22", "extended", { line2: "10/26(월) 마감" }],
    ["내일 마감 over 연장 the day before the extended deadline", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("extended"))), "2026-10-25", "urgent", {}],
    ["변경 on a change the notice states", () => recordFrom(WINDOW, (r) => r.statedChanges.push({ what: "date", from: null, to: statement("x").ev })), "2026-10-22", "changed", {}],
    ["none for a sub-option's cancellation", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled", { tag: "1차", tagBy: "section" }))), "2026-10-22", null, { status: "open" }],
    ["none for another thing's cancellation", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled", { thing: "th_other" }))), "2026-10-22", null, { status: "open" }],
  ])("%s", (_label, record, day, tone, fields) => {
    // Act
    const row = toFactsRow(sourceOf(record()), kstNoon(day));

    // Assert
    expect(row.token?.tone ?? null).toBe(tone);
    expect(row).toMatchObject(fields);
  });

  it("reads 오늘 for an event today whose sign-up has closed, with line 2 on the closed sign-up", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) =>
      r.times.push({ ...recordFrom(WINDOW).times[0], id: "tm_signup", thing: MAIN_THING, start: { ...r.times[0].start, date: "2026-10-13" }, end: { ...r.times[0].start, date: "2026-10-20" } }),
    );

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-29"));

    // Assert
    expect(row).toMatchObject({ token: { text: "오늘", tone: "today" }, urgent: false, status: "closed", line2: "10/20(화) 마감됨", itemId: "tm_signup" });
  });

  it("gives no deadline token to a window that has not opened, even one that opens and closes tomorrow", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.times[0].start.date = "2026-10-26"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, status: "notYetOpen", line2: "내일 접수 시작 · 내일 마감" });
  });

  it("reads the deadline of the window line 2 shows, not a later step's due tomorrow", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.times[0].end.date = "2026-11-13";
      r.times.push({ ...r.times[0], id: "tm_step", entry: false, end: { ...r.times[0].end, date: "2026-10-26" } });
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, urgent: false, line2: "11/13(금) 마감", status: "open" });
  });
});

describe("toFactsRow, the D7 change signal against factsHistory", () => {
  const snapshot = (extractedAt: string, end: string): FactsSnapshot => ({
    extractedAt,
    inputHash: extractedAt,
    times: [{ id: "tm_old", kind: "window", start: "2026-10-19", end, places: [] }],
    status: [],
  });
  const extractedOn = (extractedAt: string) => recordFrom(WINDOW, (r) => (r.extractedAt = extractedAt));

  it.each<[string, string, FactsSnapshot[], RowTokenTone | null]>([
    ["marks a date that moved since the version before", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-15T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks a date moved weeks after the first version", "2026-10-21T00:00:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks a version replaced 13 KST days ago, at 00:30 KST while UTC is a day earlier", "2026-10-08T15:30:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], "changed"],
    ["marks nothing for a version replaced 14 KST days ago, at 23:30 KST", "2026-10-08T14:30:00+00:00", [snapshot("2026-09-01T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when the dates return to an earlier version's", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-14T00:00:00+00:00", "2026-10-26"), snapshot("2026-10-15T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when the last change is older than 14 days", "2026-10-01T00:00:00+00:00", [snapshot("2026-09-20T00:00:00+00:00", "2026-10-23")], null],
    ["marks nothing when only the item ids differ", "2026-10-21T00:00:00+00:00", [snapshot("2026-10-15T00:00:00+00:00", "2026-10-26")], null],
  ])("%s", (_label, extractedAt, history, tone) => {
    // Act
    const row = toFactsRow(sourceOf(extractedOn(extractedAt), history), kstNoon("2026-10-22"));

    // Assert
    expect(row.token?.tone ?? null).toBe(tone);
  });
});

describe("toFactsRow, the D4 line kinds", () => {
  const withEnd = (time: string) => recordFrom(WINDOW, (r) => (r.times[0].end.time = time));

  it.each<[string, () => NoticeFacts, string, string]>([
    ["a deadline with its time", () => withEnd("17:00"), "2026-10-22", "10/26(월) 17시 마감"],
    ["a deadline with minutes", () => withEnd("18:30"), "2026-10-22", "10/26(월) 18시 30분 마감"],
    ["a deadline at the end of the day, with no time", () => withEnd("23:59"), "2026-10-22", "10/26(월) 마감"],
    ["a deadline today with its time", () => withEnd("17:00"), "2026-10-26", "오늘 17시 마감"],
    ["a window that opens tomorrow", () => recordFrom(WINDOW, (r) => (r.times[0].start.date = "2026-10-23")), "2026-10-22", "내일 접수 시작 · 10/26(월) 마감"],
    ["an event with its time", () => recordFrom(SESSION, (r) => (r.times[0].start.time = "11:00")), "2026-10-25", "10/29(목) 11시"],
    ["a tentative event", () => recordFrom(SESSION, (r) => (r.times[0].start.tentative = true)), "2026-10-25", "10/29(목) 예정"],
    ["an event tomorrow", () => recordFrom(SESSION), "2026-10-28", "내일"],
    ["a fuzzy deadline, as written", () => recordFrom(WINDOW, (r) => Object.assign(r.times[0].end, { fuzzy: true, latest: "2026-11-20", date: "" })), "2026-10-22", "2026. 10. 19.(월) ~ 10. 26.(월) 18:00"],
    ["a window resolved from the post with a start only", () => recordFrom(WINDOW, (r) => Object.assign(r.times[0], { relativeTo: "post", anchor: "post", end: { ...r.times[0].end, date: "" } })), "2026-10-22", "10/19(월)부터"],
    ["no date stated", () => recordFrom(STAFF), "2026-10-22", ""],
  ])("%s", (_label, record, day, line2) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).line2).toBe(line2);
  });

  it("abstains when the second read disagrees on the main thing's deadline", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.rowCheck = { deadline: "disagree", event: "none", read: {} }));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ line2: "날짜 원문 확인", dateMark: "abstain", status: "abstain", token: null, urgent: false });
  });

  it("drops the compact title with the token when the row abstains", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.rowCheck = { deadline: "disagree", event: "none", read: {} };
      Object.assign(r.shortTitle, { compact: "장학", compactOk: true });
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-25"));

    // Assert
    expect(row).toMatchObject({ token: null, title: "장학금" });
  });

  it("reads a day the calendar cannot hold as no day, never as one in the next month", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => (r.times[0].end.date = "2026-02-31"));

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(row).toMatchObject({ status: "ongoing", line2: "10/19(월)부터", token: null });
  });

  it("keeps a stated closure closed when the date check dropped its deadline", () => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => {
      r.times[0].dateChecked = false;
      r.statusStatements.push(statement("closed"));
    });

    // Act
    const row = toFactsRow(sourceOf(record), kstNoon("2026-10-22"));

    // Assert
    expect(row).toMatchObject({ token: { text: "마감", tone: "closed" }, status: "closed", dateMark: null, dimmed: true });
  });
});

describe("toFactsRow, an open series' next session", () => {
  const SERIES = "a_series_with_no_count_and_no_end_runs_on";
  const series = (recurrence: Record<string, unknown>, start = "2026-09-03") =>
    recordFrom(SERIES, (r) => {
      Object.assign(r.times[0].recurrence, recurrence);
      r.times[0].start.date = start;
    });

  // The expected days are dateutil's rrule(...).after(now, inc=True), which row.py calls, run on 2026-10-28.
  it.each<[string, () => NoticeFacts, string, string]>([
    ["every Monday and Thursday, from a Sunday", () => series({ byday: ["mon", "thu"] }), "2026-10-25", "내일 16시 · 매주"],
    ["every other Thursday, skipping the off week", () => series({ interval: 2 }), "2026-10-20", "10/29(목) 16시 · 격주"],
    ["every day", () => series({ freq: "DAILY", byday: [] }), "2026-10-25", "오늘 16시 · 매일"],
    ["every month on its start's date", () => series({ freq: "MONTHLY", byday: [] }), "2026-10-25", "11/3(화) 16시 · 매월"],
    ["every month on the 31st, skipping a month without one", () => series({ freq: "MONTHLY", byday: [] }, "2026-08-31"), "2026-09-05", "10/31(토) 16시 · 매월"],
    ["every Thursday of every month", () => series({ freq: "MONTHLY" }), "2026-10-25", "10/29(목) 16시 · 매월"],
  ])("%s", (_label, record, day, line2) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).line2).toBe(line2);
  });
});

describe("toFactsRow, the D3 and D5 dim rules", () => {
  it.each<[string, () => NoticeFacts, string, boolean]>([
    ["a closed call", () => recordFrom(WINDOW), "2026-10-27", true],
    ["an ended event", () => recordFrom(SESSION), "2026-10-30", true],
    ["a cancelled main thing", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("cancelled"))), "2026-10-22", true],
    ["a notice for staff, with the words that say so", () => recordFrom(STAFF), "2026-10-22", true],
    ["a notice the model called staff-only with no quote", () => recordFrom(STAFF, (r) => (r.audience.forStudentsEv = null)), "2026-10-22", false],
    ["a suspended main thing", () => recordFrom(WINDOW, (r) => r.statusStatements.push(statement("suspended"))), "2026-10-22", false],
    ["an open call", () => recordFrom(WINDOW), "2026-10-22", false],
  ])("dims %s: %s", (_label, record, day, dimmed) => {
    // Act & Assert
    expect(toFactsRow(sourceOf(record()), kstNoon(day)).dimmed).toBe(dimmed);
  });
});

describe("toFactsRow, the D5 qualifier", () => {
  const condition = (type: string, quote: string) => ({
    ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" },
    type,
    polarity: "include",
    strength: "required",
    thing: MAIN_THING,
    scope: "",
    restricts: true,
    narrows: true,
    appliesTo: [],
    tag: "",
    tagBy: "",
  });

  it.each<[string, Array<[string, string]>, string]>([
    ["one restricting condition shows its words", [["degree", "석사과정만"]], "석사과정만"],
    ["two in one dimension count one dimension", [["major", "경영학과"], ["major", "경제학과"]], "조건 1개"],
    ["three over two dimensions count two", [["major", "경영학과"], ["year", "3학년 이상"], ["major", "경제학과"]], "조건 2개"],
  ])("%s", (_label, conditions, qualifier) => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => r.audience.conditions.push(...conditions.map(([type, quote]) => condition(type, quote))));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-22")).qualifier).toBe(qualifier);
  });

  const benefit = (quote: string, amount: [number, string, string] | null, isDraw = false) => ({
    ev: { src: "body", quote, start: 0, end: quote.length, match: "exact" },
    thing: MAIN_THING,
    earnedBy: isDraw ? "draw" : "selected",
    amount: amount && { value: amount[0], unit: amount[1], per: amount[2], upTo: false },
    isDraw,
    track: "",
    appliesTo: [],
    tag: "",
    tagBy: "",
  });

  it.each<[string, Array<ReturnType<typeof benefit>>, string]>([
    ["the larger of two amounts in one unit", [benefit("월 30만원", [300000, "won", "month"]), benefit("월 50만원", [500000, "won", "month"])], "월 50만원"],
    ["the first when the amounts are per different periods", [benefit("시간당 1만원", [10000, "won", "hour"]), benefit("월 40만원", [400000, "won", "month"])], "시간당 1만원"],
    ["the first when one benefit states no amount", [benefit("기념품", null), benefit("월 40만원", [400000, "won", "month"])], "기념품"],
    ["a draw, marked as one", [benefit("커피 쿠폰", null, true)], "커피 쿠폰 (추첨)"],
  ])("names the benefit: %s", (_label, benefits, qualifier) => {
    // Arrange
    const record = recordFrom(WINDOW, (r) => r.benefits.push(...benefits));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-22")).qualifier).toBe(qualifier);
  });

  it("names no place whose words code did not locate", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => (r.times[0].where.ev = null));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-25")).qualifier).toBeNull();
  });

  it("leaves out unattached facts, as the hand-edited golden case meant", () => {
    // Arrange
    const record = recordFrom(SESSION, (r) => (r.times[0].unattached = true));

    // Act & Assert
    expect(toFactsRow(sourceOf(record), kstNoon("2026-10-25"))).toMatchObject({ status: "nodate", line2: "", qualifier: null });
  });
});

describe("toFactsRow, the KST day", () => {
  it.each<[string, string, string | null]>([
    ["23:59 KST the day before the deadline", "2026-10-25T14:59:00Z", "내일 마감"],
    ["00:00 KST on the deadline day, while UTC is still the day before", "2026-10-25T15:00:00Z", "오늘"],
    ["23:59 KST on the deadline day", "2026-10-26T14:59:00Z", "오늘"],
    ["00:00 KST the day after the deadline", "2026-10-26T15:00:00Z", "마감"],
  ])("reads %s", (_label, instant, token) => {
    // Act
    const row = toFactsRow(sourceOf(recordFrom(WINDOW)), new Date(instant));

    // Assert
    expect(row.token?.text ?? null).toBe(token);
  });
});

describe("toFactsRows", () => {
  it("renders nothing for a notice with no parsed facts, in its place on the page", () => {
    // Act
    const rows = toFactsRows([null, sourceOf(recordFrom(WINDOW))], kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.line2 ?? null)).toEqual([null, "내일 마감"]);
  });

  const withCompact = (compact: string) => recordFrom(WINDOW, (r) => Object.assign(r.shortTitle, { compact, compactOk: true }));

  it("falls back to the short title when two rows of the page lead with one compact title", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청")), sourceOf(withCompact("장학 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.title)).toEqual(["장학금", "장학금"]);
  });

  it("keeps each compact title no other row of the page shows", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청")), sourceOf(withCompact("근로 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-25"));

    // Assert
    expect(rows.map((row) => row?.title)).toEqual(["장학 신청", "근로 신청"]);
  });

  it("leads with the compact title only beside a token", () => {
    // Arrange
    const sources = [sourceOf(withCompact("장학 신청"))];

    // Act
    const rows = toFactsRows(sources, kstNoon("2026-10-22"));

    // Assert
    expect(rows.map((row) => [row?.token, row?.title])).toEqual([[null, "장학금"]]);
  });
});
