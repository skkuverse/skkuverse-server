import { z } from "zod";

/** CONTRACT(skkuverse-crawler): the answer to its cycle-end ping, of which skkuverse-crawler/py/src/skkuverse_crawler/plugins/dispatch/client.py logs processed, sent and failed. */
export const sweepSummary = z.object({
  status: z.enum(["ok", "in-progress"]),
  source: z.string(),
  /** WHY: documents claimed, not groups: a merged group counts every member. */
  processed: z.number(),
  sent: z.number(),
  failed: z.number(),
  skippedNoTopics: z.number(),
  /** WHY: Cloud Function calls made, the number a merged sweep saves. */
  cfCalls: z.number().optional(),
  dedupedDocs: z.number().optional(),
  durationMs: z.number().optional(),
});

export type SweepSummary = z.input<typeof sweepSummary>;
