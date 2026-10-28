import { z } from "zod";

const screenAction = z.object({
  kind: z.enum(["map", "call", "email", "link"]),
  /** WHY: a stored place id for `map`, a phone number for `call`, an address for `email`, an http(s) URL for `link`. */
  target: z.string(),
});

/** WHY: `quote` is the record's evidence sentence, which the app highlights in the original (umbrella ADR 0009 D16). */
const screenLine = z.object({
  text: z.string(),
  sub: z.string().nullable(),
  fromPoster: z.boolean(),
  actions: z.array(screenAction),
  quote: z.string(),
});

const screenBlock = z.object({
  label: z.string(),
  lines: z.array(screenLine),
  numbered: z.boolean(),
  foldedCount: z.int().min(0),
  footerLink: z.string().nullable(),
});

const headerChange = z.object({ what: z.string(), before: z.string(), after: z.string() });

// WHY: umbrella ADR 0009 D11 to D16 as finished Korean at KST now; the app reads no `facts` and computes no relative word.
export const noticeScreen = z.object({
  header: z.object({ firstSeen: z.string(), change: headerChange.nullable() }),
  status: z.object({ word: z.string(), detail: z.string().nullable(), tone: z.enum(["open", "soon", "closed", "stopped", "neutral"]) }).nullable(),
  blocks: z.array(screenBlock),
  action: z.object({ label: z.string(), kind: z.enum(["link", "email"]), target: z.string() }).nullable(),
  collapsed: z.enum(["closed", "cancelled"]).nullable(),
  staffOnly: z.boolean(),
  posterOnly: z.boolean(),
  original: z.object({
    posterCount: z.int().min(0),
    attachments: z.array(z.object({ role: z.string(), name: z.string() })),
    links: z.array(z.object({ role: z.string(), domain: z.string() })),
  }),
});

export type NoticeScreen = z.input<typeof noticeScreen>;
