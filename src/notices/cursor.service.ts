import { Injectable } from "@nestjs/common";
import {
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
} from "./notices.cursor";
import type { CursorPayload } from "./types";

// Re-export so controllers can `instanceof`-check the SAME class the
// delegated decodeCursor throws (a re-declared copy would never match).
export { InvalidCursorError };

/**
 * CursorService — thin @Injectable delegate over the validated
 * notices.cursor pure functions. NO DB.
 *
 * The base64url cursor shape ({ d, c, i }) and the {date desc, _id desc} $or
 * filter are defined in notices.cursor. `c` (the legacy crawledAt) is still
 * encoded and validated for rollback safety but never read by the filter.
 * decode throws InvalidCursorError on any malformed input (non-string, bad
 * base64url, bad JSON, bad d/c/i field) — the controller maps that to an
 * INVALID_CURSOR 400. NO defensive narrowing that swallows the throw.
 */
@Injectable()
export class CursorService {
  /** Encode { d, c, i } → base64url cursor string. */
  encode(payload: CursorPayload): string {
    return encodeCursor(payload);
  }

  /** Decode base64url cursor → { d, c?, i }; throws InvalidCursorError on malformed input. */
  decode(str: unknown): CursorPayload {
    return decodeCursor(str);
  }

  /** Build the {date, _id} $or pagination filter for a cursor (`c` is ignored). */
  buildFilter(cursor: CursorPayload): ReturnType<typeof buildCursorFilter> {
    return buildCursorFilter(cursor);
  }
}
