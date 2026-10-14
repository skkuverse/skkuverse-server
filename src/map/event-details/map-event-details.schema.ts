import { z } from "zod";
import { isMediaUrl } from "../../infra/media-url";

// WHY: the media origin lives in infra/, which the sheet mapper may not import, so an image URL parses through this.
export const mediaUrl = z.string().refine(isMediaUrl);
