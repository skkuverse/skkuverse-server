import { z } from "zod";

const sentence = z.object({
  text: z.string().refine((text) => text.trim() !== ""),
  cites: z.array(z.number()),
});

// CONTRACT(skkuverse-ai): the 200 body of POST /api/notices/overview (skkuverse-ai/docs/notice-overview-api.md),
// shape only: whether a cite falls inside the candidates is mapOverview's check, which knows how many were sent.
export const aiOverviewResponse = z.object({
  status: z.enum(["answered", "partial", "no_answer"]),
  lead: sentence.nullable(),
  points: z.array(sentence),
  sources: z.array(z.object({ n: z.number(), contentMissing: z.preprocess((value) => value === true, z.boolean()) })),
  lang: z.enum(["ko", "en"]),
  model: z.string(),
});

export type AiOverviewSentence = z.output<typeof sentence>;
export type AiOverviewResponse = z.output<typeof aiOverviewResponse>;
export type AiOverviewStatus = AiOverviewResponse["status"];

export function parseAiOverviewResponse(body: unknown): AiOverviewResponse | null {
  const parsed = aiOverviewResponse.safeParse(body);
  return parsed.success ? parsed.data : null;
}
