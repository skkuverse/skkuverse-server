/**
 * Pure parse/build/diff for the committed shuttle timetables.
 *
 * Kept separate from set-campus-schedule.js so this module stays importable by
 * jest without inheriting argv parsing, dotenv or process.exit — the same split
 * map-places-file.js has from import-eventmap-places.js. Requiring this file
 * has no side effects and it never opens a connection.
 *
 * Each timetable lives in a file under scripts/data/ (campus-schedule.json for
 * 인자셔틀, commute-schedule.json for 통학셔틀), which is the single source of
 * truth for what bus_schedules is supposed to contain for its services. It is a
 * committed file rather than a script constant so that a semester change is a
 * reviewable git diff, and so a wrong timetable can be reverted rather than
 * re-typed.
 *
 * A file declares its own route types: they are the join key with the app's
 * badges, and each shuttle has different ones.
 */
const moment = require("moment-timezone");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sort key for entries: time ascending, then the file's declared route-type
 * order at the same time. Not cosmetic — the diff in diffEntries is keyed on
 * (time, routeType), and a stable declared order is what lets the reader trust
 * that a `-` line and a `+` line at the same minute are really two different
 * buses.
 */
function entryRank(entry, routeTypes) {
  const routeRank = String(routeTypes.indexOf(entry.routeType)).padStart(2, "0");
  return `${entry.time}#${routeRank}`;
}

/**
 * `stopTimes` lists the time at each stop of the run, in the order the bus
 * reaches them; the stop sequence itself (names, board/alight, scheduled or
 * estimated) is the service's in the stored bus-stops dataset, and
 * stopTimesMismatches (below) checks the two have the same length. `null` is a
 * time nobody knows (only allowed at an estimated stop — also checked there).
 * The first stop is where the run departs, so it must equal `time`, which
 * every client already reads.
 */
function checkStopTimes(entry, patternId) {
  const at = `${patternId} ${entry.time}`;
  const { stopTimes } = entry;
  if (!Array.isArray(stopTimes) || stopTimes.length < 2) {
    throw new Error(`${at}: stopTimes must list at least two stops`);
  }
  for (const t of stopTimes) {
    if (t !== null && (typeof t !== "string" || !TIME_RE.test(t))) {
      throw new Error(`${at}: stopTimes must be HH:mm or null, got ${JSON.stringify(t)}`);
    }
  }
  if (stopTimes[0] !== entry.time) {
    throw new Error(`${at}: stopTimes[0] must equal time, got ${JSON.stringify(stopTimes[0])}`);
  }
  let previous = "";
  for (const t of stopTimes) {
    if (t === null) continue;
    if (t < previous) {
      throw new Error(`${at}: stopTimes must not go back in time — ${t} follows ${previous}`);
    }
    previous = t;
  }
}

function entryKey(entry) {
  return `${entry.time}|${entry.routeType}`;
}

/**
 * Validates the raw file and returns it. Every failure throws — an ops script
 * must not paper over a malformed timetable, because the failure it would
 * produce instead is a wrong departure time on a live screen.
 */
function parseTimetableFile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("timetable must be a JSON object");
  }
  if (typeof raw.semester !== "string" || !raw.semester) {
    throw new Error("timetable.semester must be a non-empty string");
  }
  if (!DATE_RE.test(raw.effectiveFrom || "")) {
    throw new Error("timetable.effectiveFrom must be YYYY-MM-DD");
  }
  if (raw.effectiveUntil !== undefined) {
    if (!DATE_RE.test(raw.effectiveUntil)) {
      throw new Error("timetable.effectiveUntil must be YYYY-MM-DD when present");
    }
    if (raw.effectiveUntil < raw.effectiveFrom) {
      throw new Error(
        `timetable.effectiveUntil ${raw.effectiveUntil} is earlier than effectiveFrom ${raw.effectiveFrom}`,
      );
    }
  }
  const { routeTypes } = raw;
  if (
    !Array.isArray(routeTypes) ||
    routeTypes.length === 0 ||
    !routeTypes.every((t) => typeof t === "string" && t) ||
    new Set(routeTypes).size !== routeTypes.length
  ) {
    throw new Error("timetable.routeTypes must be a non-empty list of distinct route-type names");
  }
  if (!Array.isArray(raw.patterns) || raw.patterns.length === 0) {
    throw new Error("timetable.patterns must be a non-empty array");
  }

  const seenPatternKeys = new Set();
  const daysByService = new Map();

  for (const pattern of raw.patterns) {
    const { patternId, days, serviceIds, entries } = pattern;

    if (typeof patternId !== "string" || !patternId) {
      throw new Error("pattern.patternId must be a non-empty string");
    }
    if (!Array.isArray(days) || days.length === 0) {
      throw new Error(`${patternId}: pattern.days must be a non-empty array`);
    }
    for (const day of days) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw new Error(`${patternId}: days must be ISO weekday integers 1-7, got ${JSON.stringify(day)}`);
      }
    }
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      throw new Error(`${patternId}: pattern.serviceIds must be a non-empty array`);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${patternId}: pattern.entries must be a non-empty array`);
    }

    for (const serviceId of serviceIds) {
      const key = `${serviceId}/${patternId}`;
      if (seenPatternKeys.has(key)) {
        throw new Error(`duplicate pattern ${key}`);
      }
      seenPatternKeys.add(key);

      // Two patterns of one service in one file must never claim the same
      // weekday: they share the file's range, so both would apply to every such
      // date. ScheduleService only logs a pattern_conflict and serves one of
      // them; the file is where the mistake can still be refused.
      const claimed = daysByService.get(serviceId) || new Set();
      for (const day of days) {
        if (claimed.has(day)) {
          throw new Error(`${serviceId}: weekday ${day} is claimed by more than one pattern`);
        }
        claimed.add(day);
      }
      daysByService.set(serviceId, claimed);
    }

    const seenEntryKeys = new Set();
    let previousRank = "";

    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${patternId}: each entry must be an object`);
      }
      // Rejected by name, not ignored. index is derived from array position by
      // buildDocuments; a hand-written one is how you get two entries numbered
      // 5 after an insertion, and silently accepting it would hide that.
      if ("index" in entry) {
        throw new Error(`${patternId}: entry must not carry "index" — it is derived from position`);
      }
      const unknownKeys = Object.keys(entry).filter(
        (k) => !["time", "routeType", "busCount", "notes", "stopTimes"].includes(k),
      );
      if (unknownKeys.length > 0) {
        throw new Error(`${patternId}: unknown entry key(s) ${unknownKeys.join(", ")}`);
      }
      if (typeof entry.time !== "string" || !TIME_RE.test(entry.time)) {
        throw new Error(`${patternId}: entry.time must be HH:mm 24h, got ${JSON.stringify(entry.time)}`);
      }
      if (!routeTypes.includes(entry.routeType)) {
        throw new Error(
          `${patternId} ${entry.time}: routeType must be one of the declared ${routeTypes.join("/")}, got ${JSON.stringify(entry.routeType)}`,
        );
      }
      if (!Number.isInteger(entry.busCount) || entry.busCount < 1) {
        throw new Error(
          `${patternId} ${entry.time}: busCount must be an integer >= 1, got ${JSON.stringify(entry.busCount)}`,
        );
      }
      if (entry.notes !== null && (typeof entry.notes !== "string" || !entry.notes)) {
        throw new Error(
          `${patternId} ${entry.time}: notes must be null or a non-empty string, got ${JSON.stringify(entry.notes)}`,
        );
      }
      if ("stopTimes" in entry) {
        checkStopTimes(entry, patternId);
      }

      const key = entryKey(entry);
      if (seenEntryKeys.has(key)) {
        throw new Error(`${patternId}: duplicate entry ${key}`);
      }
      seenEntryKeys.add(key);

      const rank = entryRank(entry, routeTypes);
      if (rank < previousRank) {
        throw new Error(
          `${patternId}: entries must be sorted by time then declared routeType order — ${entry.time} ${entry.routeType} follows ${previousRank.split("#")[0]}`,
        );
      }
      previousRank = rank;
    }
  }

  return raw;
}

/**
 * Expands the patterns into the bus_schedules documents, one per
 * (serviceId, patternId). index is assigned here from array position, and the
 * file's range is written into every document: the engine reads it per
 * pattern, and replaceOne drops an effectiveUntil the file stops declaring.
 */
function buildDocuments(timetable) {
  const docs = [];
  for (const pattern of timetable.patterns) {
    for (const serviceId of pattern.serviceIds) {
      const doc = {
        serviceId,
        patternId: pattern.patternId,
        days: [...pattern.days],
        effectiveFrom: timetable.effectiveFrom,
        entries: pattern.entries.map((entry, i) => ({
          index: i + 1,
          time: entry.time,
          routeType: entry.routeType,
          busCount: entry.busCount,
          notes: entry.notes,
          // Only when the file has them, so 인자셔틀 documents stay byte-identical.
          ...(entry.stopTimes ? { stopTimes: [...entry.stopTimes] } : {}),
        })),
      };
      if (timetable.effectiveUntil !== undefined) {
        doc.effectiveUntil = timetable.effectiveUntil;
      }
      docs.push(doc);
    }
  }
  return docs;
}

/** The range lines of a document diff; empty when both bounds agree. */
function diffRange(current, target) {
  const lines = [];
  for (const field of ["effectiveFrom", "effectiveUntil"]) {
    const before = current?.[field] ?? null;
    const after = target[field] ?? null;
    if (before !== after) {
      lines.push(`${field} ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
  }
  return lines;
}

function rangesOverlap(a, b) {
  const aFrom = a.effectiveFrom ?? "0000-01-01";
  const aUntil = a.effectiveUntil ?? "9999-12-31";
  const bFrom = b.effectiveFrom ?? "0000-01-01";
  const bUntil = b.effectiveUntil ?? "9999-12-31";
  return aFrom <= bUntil && bFrom <= aUntil;
}

/**
 * Pairs of patterns that would both apply to some date: a document the file
 * writes, and one already in the database for the same service under another
 * patternId, sharing a weekday with an overlapping range. Writing either would
 * leave the engine to pick one (ScheduleService logs pattern_conflict), so the
 * tool refuses. Ranges that only meet end to end — one ending 2026-12-18, the
 * next starting 2026-12-21 — do not overlap.
 */
function findOverlaps(targetDocs, existingDocs) {
  const targetKeys = new Set(targetDocs.map((d) => `${d.serviceId}/${d.patternId}`));
  const overlaps = [];
  for (const target of targetDocs) {
    for (const other of existingDocs) {
      if (other.serviceId !== target.serviceId) continue;
      if (targetKeys.has(`${other.serviceId}/${other.patternId}`)) continue;
      const sharedDay = target.days.some((day) => (other.days || []).includes(day));
      if (sharedDay && rangesOverlap(target, other)) {
        overlaps.push({ target, other });
      }
    }
  }
  return overlaps;
}

/**
 * Diffs two entry arrays keyed on (time, routeType) rather than position.
 *
 * Positional diffing is useless for this data: inserting a 10:10 bus shifts
 * `index` on every later entry, so a positional diff renders ten spurious
 * changes and buries the two that matter.
 */
function diffEntries(currentEntries, targetEntries, routeTypes) {
  const current = new Map((currentEntries || []).map((e) => [entryKey(e), e]));
  const target = new Map(targetEntries.map((e) => [entryKey(e), e]));

  const lines = [];
  for (const [key, entry] of target) {
    const before = current.get(key);
    if (!before) {
      lines.push({ kind: "add", entry });
    } else if (
      before.busCount !== entry.busCount ||
      (before.notes ?? null) !== entry.notes ||
      JSON.stringify(before.stopTimes ?? null) !== JSON.stringify(entry.stopTimes ?? null)
    ) {
      lines.push({ kind: "change", entry, before });
    }
  }
  for (const [key, entry] of current) {
    if (!target.has(key)) {
      lines.push({ kind: "remove", entry });
    }
  }

  lines.sort((a, b) => entryRank(a.entry, routeTypes).localeCompare(entryRank(b.entry, routeTypes)));
  return lines;
}

function stopTimesMismatch(entry, sequence) {
  if (sequence === undefined) return "stop times, but bus-stops holds no sequence for this route type";
  if (!Array.isArray(entry.stopTimes)) return `no stop times for a sequence of ${sequence.length} stops`;
  if (entry.stopTimes.length !== sequence.length) return `${entry.stopTimes.length} stop times for a sequence of ${sequence.length} stops`;
  const unknown = entry.stopTimes.findIndex((t, i) => t === null && sequence[i].timing !== "estimated");
  return unknown === -1 ? null : `no time at stop ${unknown}, which the sequence schedules`;
}

/**
 * The entries of `docs` (bus_schedules documents, or what buildDocuments makes
 * of a file) whose stop times do not follow their sequence in `sequences`, the
 * stored bus-stops dataset's `data.sequences` (service id -> route type -> the
 * stops of every run): a count other than the sequence's stops, a null where
 * the sequence schedules the stop, no stop times, or stop times for a route
 * type with no sequence. A service with no sequence whose entries carry no stop
 * times is not checked. Each as { serviceId, routeType, patternId, time,
 * message }, the message naming all four.
 *
 * Both writers run it
 * (openspec/changes/archive/2026-10-22-unify-bus-stops design D6)
 * over the served half of splitExpired: `npm run data -- push bus-stops`
 * against the target's stored timetables, and `npm run schedule` against the
 * target's stored bus-stops. It reads the sequences raw,
 * counting stops and reading `timing`, since this is CommonJS outside dist/.
 */
function stopTimesMismatches(docs, sequences) {
  return docs.flatMap((doc) => {
    const byRouteType = sequences[doc.serviceId];
    return (doc.entries ?? []).flatMap((entry) => {
      if (byRouteType === undefined && entry.stopTimes === undefined) return [];
      const message = stopTimesMismatch(entry, byRouteType?.[entry.routeType]);
      if (message === null) return [];
      const { serviceId, patternId } = doc;
      return [{ serviceId, routeType: entry.routeType, patternId, time: entry.time, message: `${serviceId} ${entry.routeType} ${entry.time} (${patternId}): ${message}` }];
    });
  });
}

/** `now`'s date in Seoul, the date ScheduleService resolves today by (src/bus/schedule/bus-schedule.service.ts). */
function kstDateOf(now) {
  return moment(now).tz("Asia/Seoul").format("YYYY-MM-DD");
}

/**
 * The documents of `docs` that serve a date from today (KST) on, and the rest,
 * each with the line that says why it is not checked. It mirrors
 * isPatternInEffect in src/bus/schedule/bus-schedule.rules.ts, which serves a
 * date only while it is not after `effectiveUntil`: a pattern ending today
 * still serves today, and one with no end never stops.
 *
 * Both writers check only the served half with stopTimesMismatches (review F1
 * of openspec/changes/archive/2026-10-22-unify-bus-stops wave 2):
 * `npm run schedule` never deletes a pattern, so an old semester's stays
 * stored, and checking its stop times against a new sequence length would
 * refuse both tools for good. The smart
 * view may still show it on an earlier day of this week, where the estimate
 * mapper leaves an entry that does not fit its sequence as stored.
 */
function splitExpired(docs, now) {
  const today = kstDateOf(now);
  const isExpired = (doc) => doc.effectiveUntil !== undefined && doc.effectiveUntil < today;
  return {
    served: docs.filter((doc) => !isExpired(doc)),
    expired: docs.filter(isExpired).map(({ serviceId, patternId, effectiveUntil }) => ({
      serviceId,
      patternId,
      effectiveUntil,
      message: `${serviceId}/${patternId} ended ${effectiveUntil}, before today ${today} (KST): it serves no date ahead, so its stop times are not checked`,
    })),
  };
}

module.exports = {
  buildDocuments,
  diffEntries,
  diffRange,
  entryKey,
  entryRank,
  findOverlaps,
  parseTimetableFile,
  splitExpired,
  stopTimesMismatches,
};
