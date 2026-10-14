import { z } from "zod";
import { noticesConfig } from "../notices.config";

export const noticeDetailRequest = z.object({
  sourceId: z.string().refine((id) => noticesConfig.sourceById.has(id), {
    error: (issue) => `unknown sourceId: ${String(issue.input)}`,
  }),
  articleNo: z
    .string()
    .regex(/^\d+$/, { error: "articleNo must be numeric" })
    .transform((s) => Number(s)),
});

export type NoticeDetailRequest = z.output<typeof noticeDetailRequest>;
