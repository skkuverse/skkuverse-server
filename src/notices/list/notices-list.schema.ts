import { z } from "zod";
import { SUMMARY_TYPES } from "../notices.constants";
import { noticesConfig } from "../notices.config";
import { toSearchQuery, toSourceIds } from "../notices.rules";
import { CURSOR_MESSAGE, DEFAULT_LIMIT, MAX_LIMIT, TYPE_MESSAGE } from "./notices-list.constants";
import { NoticesListCursorError } from "./notices-list.error";
import { decodeCursor } from "./notices-list.rules";
import type { CursorPayload } from "./notices-list.types";

const isKnownSourceId = (id: string): boolean => noticesConfig.sourceById.has(id);

// WHY: parseInt is the route's contract: "12abc" reads as 12, and anything unreadable is the default.
const limit = z.unknown().optional().transform((raw) => {
  const parsed = parseInt(raw as string, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT, 1), MAX_LIMIT);
});

const type = z.preprocess((v) => (v === "" ? undefined : v), z.enum(SUMMARY_TYPES, { error: TYPE_MESSAGE }).optional());

const cursor = z.unknown().optional().transform((raw, ctx): CursorPayload | null => {
  if (!raw) return null;
  try {
    return decodeCursor(raw);
  } catch (err) {
    if (!(err instanceof NoticesListCursorError)) throw err;
    ctx.addIssue({ code: "custom", message: CURSOR_MESSAGE, path: [] });
    return z.NEVER;
  }
});

const searchQuery = z.unknown().optional().transform((raw) => toSearchQuery(raw) ?? undefined);

export const sourceListRequest = z.object({
  sourceId: z.string().refine(isKnownSourceId, { error: (issue) => `unknown sourceId: ${String(issue.input)}` }),
  limit,
  type,
  cursor,
  q: searchQuery,
});

// WHY: a repeated `sourceIds` (an array) reads as none, a 400, as on GET /notices/overview; the ids are comma-joined.
export const multiListRequest = z.object({
  sourceIds: z.unknown().optional().transform((raw) => toSourceIds(typeof raw === "string" ? raw : "", isKnownSourceId)),
  limit,
  type,
  cursor,
  q: searchQuery,
});

export type SourceListRequest = z.output<typeof sourceListRequest>;
export type MultiListRequest = z.output<typeof multiListRequest>;
