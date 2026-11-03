import { pick } from "../infra/i18n";
import type { I18n, SupportedLang } from "../infra/types";
import type { TopisAnswer } from "./bus.types";

const AXIOS_TIMEOUT_CODES: ReadonlySet<string> = new Set(["ECONNABORTED", "ETIMEDOUT"]);

export function toTopisAnswer(err: unknown): TopisAnswer {
  const { response, code, message } = err as { response?: { status: number; data: unknown }; code?: string; message?: string };
  if (response) return { status: response.status, body: response.data };
  return { reason: code ?? message ?? "no answer", timedOut: code !== undefined && AXIOS_TIMEOUT_CODES.has(code) };
}

type LineStation = { name: string; stopId: string | null };

/** WHY: each stop of the HSSC line named as its own stop page names it; a position with no stop keeps the line's name. */
export function toCatalogNamedLine(line: readonly LineStation[], stops: ReadonlyArray<{ id: string; name: I18n }>, lang: SupportedLang): LineStation[] {
  return line.map(({ name, stopId }) => {
    if (stopId === null) return { name, stopId };
    const stop = stops.find((candidate) => candidate.id === stopId);
    if (!stop) throw new Error(`bus-stops: the HSSC line names stop ${stopId}, which a push refuses`);
    return { name: pick(stop.name, lang) ?? stop.name.ko, stopId };
  });
}
