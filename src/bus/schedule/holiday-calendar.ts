import { readFileSync } from "fs";
import { join } from "path";
import Holidays from "date-holidays";

export interface RestDays {
  /** "YYYY-MM-DD" → label, applies once. */
  exact: Map<string, string>;
  /** "MM-DD" → label, recurs every year (e.g. 공자탄신일 on 09-28). */
  annual: Map<string, string>;
}

const EXACT_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ANNUAL_KEY = /^\d{2}-\d{2}$/;

/**
 * Splits the rest-day JSON into one-off and annual entries. Keys starting with
 * "_" are documentation and skipped. Any other malformed key or non-string
 * value throws: a key like "2026-9-28" would otherwise never match any date,
 * silently.
 */
export function parseRestDays(raw: Record<string, unknown>): RestDays {
  const exact = new Map<string, string>();
  const annual = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (typeof value !== "string" || value === "") {
      throw new Error(`skku-rest-days.json: "${key}" needs a non-empty string label`);
    }
    if (EXACT_KEY.test(key)) {
      exact.set(key, value);
    } else if (ANNUAL_KEY.test(key)) {
      annual.set(key, value);
    } else {
      throw new Error(`skku-rest-days.json: "${key}" is neither YYYY-MM-DD nor MM-DD`);
    }
  }
  return { exact, annual };
}

// Loaded once at module load. The JSON is staged into dist/ by
// scripts/copy-build-assets.js; without that step the file is absent in the
// Docker runtime image and this read throws on boot (fail-loud, intended).
const SKKU_REST_DAYS: RestDays = parseRestDays(
  JSON.parse(
    readFileSync(join(__dirname, "skku-rest-days.json"), "utf8"),
  ) as Record<string, unknown>,
);

/** Exact date first, then the yearly MM-DD rule. */
export function lookupRestDay(
  restDays: RestDays,
  dateStr: string,
): string | null {
  return (
    restDays.exact.get(dateStr) ?? restDays.annual.get(dateStr.slice(5)) ?? null
  );
}

// Korea public-holiday calendar. date-holidays computes holidays
// algorithmically for any year (incl. 대체공휴일/substitute holidays), so there
// is no annual dependency bump — unlike year-pinned gazette packages. Ad-hoc
// 임시공휴일 the library can't predict are covered by SKKU_REST_DAYS.
const krHolidays = new Holidays("KR");

/**
 * Returns a Korean label if `dateStr` (YYYY-MM-DD, Asia/Seoul) is a
 * non-operating day, else null. The SKKU manual list wins over the public
 * holiday calendar on overlapping dates (more specific / school-context label).
 */
export function getNonOperatingDayLabel(dateStr: string): string | null {
  const skku = lookupRestDay(SKKU_REST_DAYS, dateStr);
  if (skku) return skku;

  // Noon KST so the absolute instant resolves to the intended calendar date
  // regardless of the host timezone.
  const result = krHolidays.isHoliday(new Date(`${dateStr}T12:00:00+09:00`));
  if (result) {
    const publicHoliday = result.find((h) => h.type === "public");
    if (publicHoliday) return publicHoliday.name;
  }
  return null;
}
