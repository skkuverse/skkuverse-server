/**
 * The list's reshaping: the v1/v2 brief dispatch (toSummaryBrief), the list item and the page cut from a
 * read of limit + 1, and the cursor encoding (ADR 0007: `c` is still emitted, so a rollback can decode it).
 *
 * The item's `row` is the facts row the row service rendered, under the wire names of the app's SketchRow
 * (line 2 is `when`), with the day group of its posting date and, on a multi-source read, the board name.
 */
import { ObjectId } from "mongodb";
import type { NoticeDoc, SummaryDate } from "../notices.document";
import { toSummaryBrief, encodeCursor, toItemRow, toListItem, toNoticePage, withDerivedBrief } from "./notices-list.mapper";
import type { FactsRow } from "../row/notices-row.types";
import { decodeCursor } from "./notices-list.rules";

const NOW = new Date("2026-10-09T12:00:00+09:00");
const OID = "66a1b2c3d4e5f6a7b8c9d0e1";
const ISO = "2026-04-01T00:00:00.000Z";

function date(
  role: string,
  startAt: string | null,
  endAt: string | null,
  subject = role,
): SummaryDate {
  return { evidence: "", subject, role, endType: "range", startAt, endAt };
}

function app(...windows: { startAt: string | null; endAt: string | null; openEnded?: boolean }[]) {
  return {
    status: windows.length > 0 ? "dated" : "none",
    windows: windows.map((w) => ({ openEnded: false, ...w })),
  };
}

describe("toSummaryBrief — v1 / v2 dispatch", () => {
  function doc(extra: Partial<NoticeDoc>): NoticeDoc {
    return {
      _id: new ObjectId(),
      sourceId: "skku-main",
      articleNo: 1,
      title: "t",
      date: "2026-10-01",
      crawledAt: new Date(),
      sourceUrl: "https://example.com",
      summaryAt: new Date("2026-10-01T00:00:00Z"),
      summaryOneLiner: "한 줄",
      ...extra,
    };
  }

  const v1Periods = [
    { label: "행사", startDate: "2026-10-15", endDate: "2026-10-15" },
  ];

  it("uses the role badge for a v2 notice, ignoring the stored type", () => {
    // Act
    const brief = toSummaryBrief(
      doc({
        summaryVersion: 2,
        summaryType: "event",
        summaryPeriods: v1Periods,
        summaryApplication: app({ startAt: null, endAt: "2026-10-14T00:00:00+09:00" }),
        summaryDates: [date("apply", null, "2026-10-14T00:00:00+09:00", "신청")],
      }),
      NOW,
    );

    // Assert
    expect(brief).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-13", time: null, label: "신청" },
    });
  });

  it("keeps the v1 path when the notice is not v2", () => {
    // Act
    const v1 = toSummaryBrief(doc({ summaryType: "event", summaryPeriods: v1Periods }), NOW);

    // Assert
    expect(v1).toEqual({
      oneLiner: "한 줄",
      type: "event",
      startAt: { date: "2026-10-15", time: null },
      endAt: { date: "2026-10-15", time: null, label: "행사" },
    });

    const noDates = toSummaryBrief(
      doc({ summaryVersion: 2, summaryType: "event", summaryPeriods: v1Periods }),
      NOW,
    );
    expect(noDates).toEqual(v1);
  });

  it("returns null before the notice is summarized", () => {
    // Act & Assert
    expect(toSummaryBrief(doc({ summaryAt: null, summaryVersion: 2, summaryDates: [] }), NOW)).toBeNull();
  });
});

describe("encodeCursor", () => {
  it("still emits c, so a cursor minted here survives a rollback", () => {
    // Arrange
    const encoded = encodeCursor({ d: "2026-04-01", c: ISO, i: OID });

    // Act
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString());

    // Assert
    expect(decoded).toEqual({ d: "2026-04-01", c: ISO, i: OID });
  });

  it("round-trips through decodeCursor", () => {
    // Act
    const payload = { d: "2026-04-01", c: ISO, i: OID };

    // Assert
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });
});

describe("toListItem", () => {
  const base = {
    _id: new ObjectId(OID),
    sourceId: "skku-notice02",
    articleNo: 140577,
    title: "제목",
    date: "2026-10-14",
    crawledAt: new Date(ISO),
    sourceUrl: "https://www.skku.edu/x",
  };

  it("serves defaults for every optional field the crawler may leave out", () => {
    // Act
    const item = toListItem(base, NOW, null);

    // Assert
    expect(item).toEqual({
      id: OID,
      sourceId: "skku-notice02",
      articleNo: 140577,
      title: "제목",
      category: null,
      author: null,
      department: null,
      date: "2026-10-14",
      views: 0,
      sourceUrl: "https://www.skku.edu/x",
      hasContent: false,
      hasAttachments: false,
      isEdited: false,
      summary: null,
      row: null,
    });
  });

  it("serves the derived brief when the notice has no summary, and its own summary when it has one", () => {
    // Arrange
    const derived = { oneLiner: "내일 마감", type: "action_required" as const, startAt: null, endAt: { date: "2026-10-10", time: null, label: null } };
    const stored = { ...base, summaryAt: new Date(ISO), summaryOneLiner: "한 줄", summaryType: "event" };

    // Act
    const withoutSummary = withDerivedBrief(toListItem(base, NOW, null), derived);
    const withSummary = withDerivedBrief(toListItem(stored, NOW, null), derived);

    // Assert
    expect(withoutSummary.summary).toEqual(derived);
    expect(withSummary.summary).toEqual(toSummaryBrief(stored, NOW));
    expect(withSummary.summary?.oneLiner).toBe("한 줄");
  });

  it("turns empty strings to null, and reads content, attachments and edits as flags", () => {
    // Act
    const item = toListItem(
      { ...base, category: "", author: "작성자", views: 7, contentHash: "h", attachments: [{ name: "a", url: "u" }], editCount: 2 },
      NOW,
      null,
    );

    // Assert
    expect(item).toMatchObject({ category: null, author: "작성자", views: 7, hasContent: true, hasAttachments: true, isEdited: true });
  });
});

describe("toItemRow", () => {
  const doc: NoticeDoc = {
    _id: new ObjectId(OID),
    sourceId: "skku-notice02",
    articleNo: 140577,
    title: "제목",
    date: "2026-10-09",
    crawledAt: new Date(ISO),
    sourceUrl: "https://www.skku.edu/x",
  };
  const factsRow: FactsRow = {
    token: { text: "내일 마감", tone: "urgent" },
    title: "장학금",
    line2: "10/10(토) 마감",
    trackedLine2: "[1차] 10/10(토) 마감",
    qualifier: "조건 2개",
    dateMark: "warning",
    dimmed: false,
    urgent: true,
    status: "open",
    itemId: "tm_1",
  };
  const boardNameById = new Map([["skku-notice02", "성균관대_통합(학사)"]]);
  const single = { now: NOW, boardNameById: null };
  const multi = { now: NOW, boardNameById };

  it("serves the facts row under the sketch's names: line 2 is `when`, and the status and item id stay out", () => {
    // Act
    const row = toItemRow(factsRow, doc, single);

    // Assert
    expect(row).toEqual({
      token: { text: "내일 마감", tone: "urgent" },
      title: "장학금",
      when: "10/10(토) 마감",
      urgent: true,
      dateMark: "warning",
      qualifier: "조건 2개",
      board: null,
      dimmed: false,
      day: "today",
    });
  });

  it("serves a row with no token, qualifier or date mark as nulls, never leaving a key out", () => {
    // Arrange
    const plain: FactsRow = { ...factsRow, token: null, qualifier: null, dateMark: null, urgent: false };

    // Act
    const row = toItemRow(plain, doc, single);

    // Assert
    expect(row).toMatchObject({ token: null, qualifier: null, dateMark: null, urgent: false });
    expect(Object.keys(row).sort()).toEqual(["board", "dateMark", "day", "dimmed", "qualifier", "title", "token", "urgent", "when"]);
  });

  it("names the board only when the read was multi-source, and as null for a source the config does not know", () => {
    // Act
    const rows = [toItemRow(factsRow, doc, single), toItemRow(factsRow, doc, multi), toItemRow(factsRow, { ...doc, sourceId: "gone" }, multi)];

    // Assert
    expect(rows.map((row) => row.board)).toEqual([null, "성균관대_통합(학사)", null]);
  });

  it("groups by the posting date, whatever the ObjectId's time says", () => {
    // Arrange
    const insertedLongAgo = ObjectId.createFromTime(Date.parse("2026-03-01T12:00:00+09:00") / 1000);
    const posted = (postedDate: string) => ({ ...doc, _id: insertedLongAgo, date: postedDate });

    // Act
    const days = [posted("2026-10-09"), posted("2026-10-08"), posted("2026-10-06 18:30"), posted("2026-10-01")].map((posting) => toItemRow(factsRow, posting, single).day);

    // Assert
    expect(days).toEqual(["today", "yesterday", "thisWeek", "earlier"]);
  });
});

describe("toListItem row", () => {
  it("carries the item row it is given, and null when the notice has none", () => {
    // Arrange
    const doc: NoticeDoc = { _id: new ObjectId(OID), sourceId: "s", articleNo: 1, title: "t", date: "2026-10-14", crawledAt: new Date(ISO), sourceUrl: "u" };
    const itemRow = { token: null, title: "t", when: "w", urgent: false, dateMark: null, qualifier: null, board: null, dimmed: false, day: "today" } as const;

    // Act & Assert
    expect(toListItem(doc, NOW, itemRow).row).toBe(itemRow);
    expect(toListItem(doc, NOW, null).row).toBeNull();
  });
});

describe("toNoticePage", () => {
  const doc = (n: number): NoticeDoc => ({
    _id: new ObjectId(n.toString(16).padStart(24, "0")),
    sourceId: "s",
    articleNo: n,
    title: "t",
    date: "2026-10-1" + n,
    crawledAt: new Date(ISO),
    sourceUrl: "u",
  });

  it("keeps `limit` documents and seeds the cursor from the last one kept when one more was read", () => {
    // Act
    const page = toNoticePage([doc(3), doc(2), doc(1)], 2);

    // Assert
    expect(page.items.map((d) => d.articleNo)).toEqual([3, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor)).toEqual({ d: "2026-10-12", c: ISO, i: doc(2)._id.toHexString() });
  });

  it("has no cursor when the read held `limit` documents or fewer", () => {
    // Act & Assert
    expect(toNoticePage([doc(2), doc(1)], 2)).toEqual({ items: [doc(2), doc(1)], nextCursor: null, hasMore: false });
  });
});
