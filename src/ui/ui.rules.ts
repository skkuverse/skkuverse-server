import moment from "moment-timezone";
import type { BusGroupVisibility } from "../bus/config/bus-config.types";
import type { LinkActionType } from "../shared/link-action.wire";
import { KST_TIME_ZONE } from "../shared/time-zone.constants";
import type { BannerImageRaw } from "./ui.schema";
import type { MiniAppGrammar, MiniAppReference, MiniAppRegistry, TargetGrammar } from "./ui.types";

export function isBannerShowing(image: Pick<BannerImageRaw, "startAt" | "endAt">, now: Date): boolean {
  const at = now.getTime();
  if (image.startAt !== undefined && at < Date.parse(image.startAt)) return false;
  return image.endAt === undefined || at < Date.parse(image.endAt);
}

type LinkAction = { actionType?: LinkActionType; actionValue?: string };

export function toMiniAppTargetReferences(link: LinkAction, path: MiniAppReference["path"], grammar: TargetGrammar): MiniAppReference[] {
  const target = link.actionType === "miniapp" ? grammar.parseTarget(link.actionValue) : null;
  return target === null ? [] : [{ dataset: "miniapps", id: target.id, path }];
}

// WHY: data that names no mini app is checked with no registry read; with no reference, no id is ever asked about.
export function toGrammarOnlyRegistry(grammar: MiniAppGrammar): MiniAppRegistry {
  return {
    isRegistered: () => false,
    isKnownMiniAppTarget: () => false,
    parseTarget: (value) => grammar.parseTarget(value),
    isSingleEmoji: (value) => grammar.isSingleEmoji(value),
  };
}

export function findRepeatedId<T extends { id: string }>(items: readonly T[]): T | undefined {
  return items.find((item, index) => items.findIndex((other) => other.id === item.id) !== index);
}

const FIRST_DAY_OPENING_FORMAT = "YYYY-MM-DD HH:mm";

// QUIRK(moment): a strict parse still takes "24:00" as the next midnight, so the parse is compared back to the input.
// WHY: bus parses fromTime at import (bus-config.config.ts), which is the gate; this throw is the second line.
function toFirstDayOpening(from: string, fromTime: string): moment.Moment {
  const written = `${from} ${fromTime}`;
  const opensAt = moment.tz(written, FIRST_DAY_OPENING_FORMAT, true, KST_TIME_ZONE);
  if (opensAt.isValid() && opensAt.format(FIRST_DAY_OPENING_FORMAT) === written) return opensAt;
  throw new Error(`bus group fromTime "${fromTime}" on ${from} is not a KST time from 00:00 to 23:59`);
}

// WHY: a date range covers its first and last day whole, in KST, whatever zone the host runs in;
// `fromTime` (KST) opens it later on the first day.
export function isBusGroupVisible(visibility: BusGroupVisibility, now: Date): boolean {
  if (visibility.type === "always") return true;
  const from = visibility.fromTime
    ? toFirstDayOpening(visibility.from, visibility.fromTime)
    : moment.tz(visibility.from, "YYYY-MM-DD", KST_TIME_ZONE).startOf("day");
  const until = moment.tz(visibility.until, "YYYY-MM-DD", KST_TIME_ZONE).endOf("day");
  return moment(now).isBetween(from, until, null, "[]");
}
