import { SUBWAY_REGISTRY } from "./subway.config";
import type { SubwayLine, SubwayRegistry } from "./subway.types";

// WHY: unreachable for a registered platform: the registry fails the boot on a platform of an unlisted line.
export function toSubwayLine(code: string, registry: SubwayRegistry = SUBWAY_REGISTRY): SubwayLine {
  const line = registry.lines.find((listed) => listed.code === code);
  if (!line) throw new Error(`subway registry: no line "${code}"`);
  return line;
}
