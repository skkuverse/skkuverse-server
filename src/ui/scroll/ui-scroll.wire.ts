import { z } from "zod";

const scrollCard = z.object({
  title: z.string(),
  icon: z.string(),
  pageLink: z.string(),
  color: z.string().optional(),
  pageWebviewLink: z.string().optional(),
  altPageLink: z.string(),
  useAltPageLink: z.boolean(),
});

export const scrollCards = z.array(scrollCard);

export const scrollCardsMeta = z.object({ itemCount: z.int() });

export type ScrollCards = z.input<typeof scrollCards>;
export type ScrollCardsMeta = z.input<typeof scrollCardsMeta>;
