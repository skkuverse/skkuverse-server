/**
 * v2 list badge (selectRoleBadge): application windows → due → happens →
 * closed → runs, rendered through the v1 brief shape the app already reads.
 */
import { ObjectId } from "mongodb";
import {
  buildSummaryBrief,
  selectRoleBadge,
} from "../../../src/notices/notices.transform";
import type { NoticeDoc, SummaryDate } from "../../../src/notices/types";

const NOW = new Date("2026-10-09T12:00:00+09:00");

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

describe("selectRoleBadge — application windows", () => {
  it("shows an upcoming multi-day window as a range to its start", () => {
    const dates = [date("apply", "2026-10-12T00:00:00+09:00", "2026-10-17T00:00:00+09:00", "1차 신청")];
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T00:00:00+09:00", endAt: "2026-10-17T00:00:00+09:00" }),
      dates,
      NOW,
    );
    expect(badge).toEqual({
      type: "informational",
      startAt: { date: "2026-10-12", time: null },
      endAt: { date: "2026-10-16", time: null, label: "1차 신청" },
    });
  });

  it("shows an upcoming one-day window as an event at its start", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T10:00:00+09:00", endAt: "2026-10-12T18:00:00+09:00" }),
      [],
      NOW,
    );
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-12", time: "10:00" },
      endAt: null,
    });
  });

  it("shows an upcoming window with no end as an event at its start", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-12T09:00:00+09:00", endAt: null, openEnded: true }),
      [],
      NOW,
    );
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-12", time: "09:00" },
      endAt: null,
    });
  });

  it("counts an open window down to its end, labeled by the date it came from", () => {
    const dates = [
      date("apply", "2026-10-01T00:00:00+09:00", "2026-10-14T00:00:00+09:00", "1차 신청"),
      date("happens", "2026-10-10T00:00:00+09:00", "2026-10-11T00:00:00+09:00", "설명회"),
    ];
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-14T00:00:00+09:00" }),
      dates,
      NOW,
    );
    // An end stored as next-day 00:00 is the end of the day before.
    expect(badge).toEqual({
      type: "action_required",
      startAt: { date: "2026-10-01", time: null },
      endAt: { date: "2026-10-13", time: null, label: "1차 신청" },
    });
  });

  it("keeps a written end time and has no start for an end-only window", () => {
    const badge = selectRoleBadge(
      app({ startAt: null, endAt: "2026-10-13T18:00:00+09:00" }),
      [date("due", null, "2026-10-13T18:00:00+09:00", "서류 제출")],
      NOW,
    );
    expect(badge).toEqual({
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-13", time: "18:00", label: "서류 제출" },
    });
  });

  it("falls back to the date with the same end when the window was merged", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-05T00:00:00+09:00", endAt: "2026-10-20T00:00:00+09:00" }),
      [date("apply", "2026-10-07T00:00:00+09:00", "2026-10-20T00:00:00+09:00", "추가 신청")],
      NOW,
    );
    expect(badge.endAt).toEqual({ date: "2026-10-19", time: null, label: "추가 신청" });
  });

  it("leaves the label null when no date matches the window", () => {
    const badge = selectRoleBadge(
      app({ startAt: null, endAt: "2026-10-20T00:00:00+09:00" }),
      [date("apply", null, "2026-10-21T00:00:00+09:00")],
      NOW,
    );
    expect(badge.endAt).toEqual({ date: "2026-10-19", time: null, label: null });
  });

  it("skips a passed window and picks the next one by end", () => {
    const badge = selectRoleBadge(
      app(
        { startAt: "2026-10-20T00:00:00+09:00", endAt: "2026-10-25T00:00:00+09:00" },
        { startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" },
      ),
      [],
      NOW,
    );
    expect(badge.type).toBe("informational");
    expect(badge.startAt).toEqual({ date: "2026-10-20", time: null });
  });

  it("holds an open-ended window with no badge for 30 days after it opens", () => {
    const open = { startAt: "2026-09-29T00:00:00+09:00", endAt: null, openEnded: true };
    expect(selectRoleBadge(app(open), [], NOW)).toEqual({
      type: "action_required",
      startAt: { date: "2026-09-29", time: null },
      endAt: null,
    });

    const stale = { startAt: "2026-08-01T00:00:00+09:00", endAt: null, openEnded: true };
    expect(selectRoleBadge(app(stale), [], NOW)).toEqual({
      type: "action_required",
      startAt: null,
      endAt: null,
    });
  });

  it("puts an open window ahead of an earlier due", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-10-01T00:00:00+09:00", endAt: "2026-10-20T00:00:00+09:00" }),
      [date("due", null, "2026-10-10T00:00:00+09:00", "납부")],
      NOW,
    );
    expect(badge.endAt?.date).toBe("2026-10-19");
  });
});

describe("selectRoleBadge — due, happens, closed", () => {
  it("counts down to the earliest future due", () => {
    const badge = selectRoleBadge(
      app(),
      [
        date("due", null, "2026-10-08T00:00:00+09:00", "지난 제출"),
        date("due", null, "2026-10-30T00:00:00+09:00", "2차 제출"),
        date("due", "2026-10-12T00:00:00+09:00", "2026-10-15T17:00:00+09:00", "1차 제출"),
      ],
      NOW,
    );
    expect(badge).toEqual({
      type: "action_required",
      startAt: { date: "2026-10-12", time: null },
      endAt: { date: "2026-10-15", time: "17:00", label: "1차 제출" },
    });
  });

  it("puts a future due ahead of an event", () => {
    const badge = selectRoleBadge(
      null,
      [
        date("happens", "2026-10-10T00:00:00+09:00", "2026-10-11T00:00:00+09:00"),
        date("due", null, "2026-10-20T00:00:00+09:00", "납부"),
      ],
      NOW,
    );
    expect(badge.type).toBe("action_required");
  });

  it("shows a one-day event at its start, dropping the same-day end", () => {
    expect(
      selectRoleBadge(null, [date("happens", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00")], NOW),
    ).toEqual({ type: "event", startAt: { date: "2026-10-15", time: null }, endAt: null });

    expect(
      selectRoleBadge(null, [date("happens", "2026-10-09T14:00:00+09:00", "2026-10-09T16:00:00+09:00")], NOW),
    ).toEqual({ type: "event", startAt: { date: "2026-10-09", time: "14:00" }, endAt: null });
  });

  it("keeps the end of a multi-day event and picks the earliest start", () => {
    const badge = selectRoleBadge(
      null,
      [
        date("happens", "2026-11-01T00:00:00+09:00", "2026-11-02T00:00:00+09:00", "2회차"),
        date("happens", "2026-10-20T00:00:00+09:00", "2026-10-23T00:00:00+09:00", "축제"),
        date("happens", "2026-10-01T00:00:00+09:00", "2026-10-02T00:00:00+09:00", "지난 행사"),
      ],
      NOW,
    );
    expect(badge).toEqual({
      type: "event",
      startAt: { date: "2026-10-20", time: null },
      endAt: { date: "2026-10-22", time: null, label: "축제" },
    });
  });

  it("anchors an end-only event on its end", () => {
    expect(
      selectRoleBadge(null, [date("happens", null, "2026-10-12T18:00:00+09:00", "시험")], NOW),
    ).toEqual({
      type: "event",
      startAt: null,
      endAt: { date: "2026-10-12", time: "18:00", label: "시험" },
    });
  });

  it("marks closed at the latest past end once every window and due passed", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" }),
      [date("due", null, "2026-09-20T18:00:00+09:00", "제출")],
      NOW,
    );
    expect(badge).toEqual({
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-09-20", time: "18:00", label: null },
    });
  });

  it("prefers a future event over the closed badge", () => {
    const badge = selectRoleBadge(
      app({ startAt: "2026-09-01T00:00:00+09:00", endAt: "2026-09-10T00:00:00+09:00" }),
      [date("happens", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00")],
      NOW,
    );
    expect(badge.type).toBe("event");
  });
});

describe("selectRoleBadge — runs and nothing", () => {
  it("shows a running multi-day range, in progress before upcoming", () => {
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-10-20T00:00:00+09:00", "2026-11-20T00:00:00+09:00", "2차 활동"),
        date("runs", "2026-09-01T00:00:00+09:00", "2026-12-01T00:00:00+09:00", "활동"),
      ],
      NOW,
    );
    expect(badge).toEqual({
      type: "informational",
      startAt: { date: "2026-09-01", time: null },
      endAt: { date: "2026-11-30", time: null, label: "활동" },
    });
  });

  it("shows the earliest upcoming range when none is in progress", () => {
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-11-01T00:00:00+09:00", "2026-11-10T00:00:00+09:00"),
        date("runs", "2026-10-20T00:00:00+09:00", "2026-10-25T00:00:00+09:00"),
      ],
      NOW,
    );
    expect(badge.startAt).toEqual({ date: "2026-10-20", time: null });
  });

  it("ignores one-day and finished ranges, results and unknown roles", () => {
    const badge = selectRoleBadge(
      null,
      [
        date("runs", "2026-10-15T00:00:00+09:00", "2026-10-16T00:00:00+09:00"),
        date("runs", "2026-08-01T00:00:00+09:00", "2026-09-01T00:00:00+09:00"),
        date("announce", "2026-10-20T00:00:00+09:00", "2026-10-21T00:00:00+09:00"),
        date("someday", "2026-10-20T00:00:00+09:00", "2026-10-25T00:00:00+09:00"),
      ],
      NOW,
    );
    expect(badge).toEqual({ type: "informational", startAt: null, endAt: null });
  });

  it("tolerates malformed input without throwing", () => {
    const junk = [
      null,
      "text",
      { role: "due", startAt: "not a date", endAt: 20261013 },
      { role: 7, startAt: null, endAt: null },
    ];
    expect(selectRoleBadge("dated", junk, NOW)).toEqual({
      type: "informational",
      startAt: null,
      endAt: null,
    });
    expect(selectRoleBadge({ windows: "none" }, undefined, NOW).type).toBe("informational");
    expect(selectRoleBadge({ windows: [null, { startAt: null, endAt: null }] }, [], NOW).type).toBe(
      "informational",
    );
  });
});

describe("buildSummaryBrief — v1 / v2 dispatch", () => {
  function doc(extra: Partial<NoticeDoc>): NoticeDoc {
    return {
      _id: new ObjectId(),
      sourceId: "skku-main",
      articleNo: "1",
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
    const brief = buildSummaryBrief(
      doc({
        summaryVersion: 2,
        summaryType: "event",
        summaryPeriods: v1Periods,
        summaryApplication: app({ startAt: null, endAt: "2026-10-14T00:00:00+09:00" }),
        summaryDates: [date("apply", null, "2026-10-14T00:00:00+09:00", "신청")],
      }),
      NOW,
    );
    expect(brief).toEqual({
      oneLiner: "한 줄",
      type: "action_required",
      startAt: null,
      endAt: { date: "2026-10-13", time: null, label: "신청" },
    });
  });

  it("keeps the v1 path when the notice is not v2", () => {
    const v1 = buildSummaryBrief(doc({ summaryType: "event", summaryPeriods: v1Periods }), NOW);
    expect(v1).toEqual({
      oneLiner: "한 줄",
      type: "event",
      startAt: { date: "2026-10-15", time: null },
      endAt: { date: "2026-10-15", time: null, label: "행사" },
    });

    const noDates = buildSummaryBrief(
      doc({ summaryVersion: 2, summaryType: "event", summaryPeriods: v1Periods }),
      NOW,
    );
    expect(noDates).toEqual(v1);
  });

  it("returns null before the notice is summarized", () => {
    expect(buildSummaryBrief(doc({ summaryAt: null, summaryVersion: 2, summaryDates: [] }), NOW)).toBeNull();
  });
});
