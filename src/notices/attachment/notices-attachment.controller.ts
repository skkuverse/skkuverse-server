import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { ZodValidationPipe } from "../../http/zod-validation.pipe";
import { IDLE_TRANSFER_MS, MAX_ATTACHMENT_BYTES, MAX_TRANSFER_MS } from "./notices-attachment.constants";
import { attachmentRequest } from "./notices-attachment.schema";
import { NoticesAttachmentService } from "./notices-attachment.service";

@Controller("notices")
export class NoticesAttachmentController {
  private readonly requestPipe = new ZodValidationPipe(attachmentRequest, "INVALID_PARAMS");

  constructor(private readonly attachment: NoticesAttachmentService) {}

  // QUIRK(skku): some department servers refuse a hotlink without their own Referer, so this proxy sends it. The
  // CORP header overrides helmet's for the skkuverse.com pages that embed the file, error answers included, so the
  // query is parsed after it is set: a parameter pipe would answer first.
  @Get("proxy/attachment")
  async proxyAttachment(@Query() query: unknown, @Res() res: Response): Promise<void> {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    const download = await this.attachment.fetchDownload(this.requestPipe.transform(query), res.req.log);
    for (const [header, value] of download.headers) res.setHeader(header, value);
    await this.stream(download.body, res);
  }

  // WHY: headers are already on the wire when a transfer fails, so a failure ends in the destroyed response.
  private async stream(body: Readable, res: Response): Promise<void> {
    const abort = new AbortController();
    const idle = setTimeout(() => abort.abort(), IDLE_TRANSFER_MS);
    const overall = setTimeout(() => abort.abort(), MAX_TRANSFER_MS);
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        idle.refresh();
        received += chunk.length;
        callback(received > MAX_ATTACHMENT_BYTES ? new Error("attachment exceeded size cap") : null, chunk);
      },
    });
    await pipeline(body, limiter, res, { signal: abort.signal }).catch(() => undefined);
    clearTimeout(idle);
    clearTimeout(overall);
  }
}
