import { DRAW_MARK, QUOTE_LABEL_JOINER } from "./notices.constants";

// WHY: the crawler stores a missing text as "" as often as null; the wire says null for both.
export function textOrNull(value: string | null | undefined): string | null {
  return value || null;
}

const squashed = (text: string): string => text.replace(/\s/g, "");

// CONTRACT(skkuverse-crawler): skkuverse-crawler/docs/notice-facts/notice-facts.schema.json, codebook v3.11: a table
// `label` plus its `quote` states the fact, which the row and the screen show as "label · quote".
export function toQuoteText({ quote, label }: { quote: string; label?: string | undefined }): string {
  const words = (label ?? "").replace(/\s+/g, " ").trim();
  return squashed(quote).includes(squashed(words)) ? quote : `${words}${QUOTE_LABEL_JOINER}${quote}`;
}

// WHY: umbrella ADR 0009 D5 and D13: a draw is always marked as one, unless its text already says so.
export function toBenefitText({ isDraw, ev }: { isDraw: boolean; ev: { quote: string; label?: string | undefined } }): string {
  const shown = toQuoteText(ev);
  return isDraw && !shown.includes(DRAW_MARK) ? `${shown} (${DRAW_MARK})` : shown;
}
