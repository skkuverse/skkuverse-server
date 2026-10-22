import { z } from "zod";
import { servedSequenceStop, servedStop } from "../bus.wire";

const visibility = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("dateRange"), from: z.string(), fromTime: z.string().optional(), until: z.string() }),
]);

const card = z.object({ themeColor: z.string(), iconType: z.string(), busTypeText: z.string(), subtitle: z.string() });

const station = z.object({
  index: z.int(),
  name: z.string(),
  subtitle: z.string().nullable(),
  stationNumber: z.string().nullable(),
  ...{ isFirstStation: z.boolean(), isLastStation: z.boolean(), isRotationStation: z.boolean() },
  transferLines: z.array(z.object({ line: z.string(), color: z.string() })),
  stopId: z.string().optional(),
});

const feature = z.object({ type: z.string(), url: z.string() });

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/bus/parser.ts drops a target it does not know (`crowding`).
const serviceRefresh = z.object({ targets: z.array(z.enum(["traffic"])), intervalSec: z.int().positive() });

const service = z.object({
  serviceId: z.string(),
  label: z.string(),
  endpoint: z.string(),
  stopSequences: z.record(z.string(), z.array(servedSequenceStop)).optional(),
  refresh: serviceRefresh.optional(),
});

const realtimeScreen = z.object({
  dataEndpoint: z.string(),
  refreshInterval: z.number(),
  lastStationIndex: z.int(),
  stations: z.array(station),
  features: z.array(feature),
  /** WHY: a Jongro route's stations version; the realtime response carries the same while this config is current. */
  stationsVersion: z.string().optional(),
  /** WHY: the live route the app moves to by OTA; dataEndpoint never changes, since installed bundles call it (ADR 0019, D11). */
  liveEndpoint: z.string(),
  /** WHY: on a loop a trajectory's s may pass the last index; place a marker at s mod the station count (ADR 0019, D7). */
  isLoop: z.boolean(),
  /** WHY: what the group's source can never supply; positionSource is an open enum, gps or stopEvents (ADR 0019, D2). */
  capabilities: z.object({ positionSource: z.string(), occupancy: z.boolean(), plateNumber: z.boolean(), lastBus: z.boolean() }),
});

const scheduleScreen = z.object({
  defaultServiceId: z.string(),
  serviceSelector: z.string().optional(),
  services: z.array(service),
  heroCard: z.null(),
  routeBadges: z.array(z.object({ id: z.string(), label: z.string(), color: z.string() })),
  stops: z.array(servedStop).optional(),
  features: z.array(feature),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/bus/parser.ts (parseBusGroup). */
export const busGroup = z.object({
  id: z.string(),
  screenType: z.enum(["realtime", "schedule"]),
  label: z.string(),
  visibility,
  card,
  screen: z.union([realtimeScreen, scheduleScreen]),
});

export const busConfig = z.object({ groups: z.array(busGroup) });

export type BusGroup = z.input<typeof busGroup>;
export type BusConfig = z.input<typeof busConfig>;
export type ServiceRefresh = z.input<typeof serviceRefresh>;
