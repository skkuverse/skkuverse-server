import { Injectable } from "@nestjs/common";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { toScrollCards } from "./ui-scroll.mapper";
import type { ScrollCards } from "./ui-scroll.wire";

@Injectable()
export class UiScrollService {
  listScrollCards(lang: SupportedLang): ScrollCards {
    return toScrollCards(lang, WEBVIEW_ORIGIN);
  }
}
