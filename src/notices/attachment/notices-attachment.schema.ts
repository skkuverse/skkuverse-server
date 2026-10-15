import { z } from "zod";

const URL_REQUIRED = "url is required";

export const attachmentRequest = z.object({
  url: z.string({ error: URL_REQUIRED }).min(1, { error: URL_REQUIRED }).refine((url) => URL.canParse(url), { error: "malformed url" }),
  referer: z.string().optional(),
  mode: z.string().optional(),
  name: z.string().optional(),
});

export type AttachmentRequest = z.output<typeof attachmentRequest>;
