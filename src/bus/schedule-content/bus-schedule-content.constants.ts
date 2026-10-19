export const BUS_SERVICE_NOTICES_DATASET = "bus-service-notices";

// WHY: a missing, invalid or unreadable dataset recurs on every read; one line a minute, as docs/reference/logging.md asks.
export const BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS = 60_000;

// CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/types/bus.ts (`ScheduleNoticeStyle`) names the styles the
// schedule screen draws; any other draws an unstyled banner. It lacks `error`, which design D7 of move-editorial-datasets keeps.
export const SERVICE_NOTICE_STYLES = ["info", "warning", "error", "ai"] as const;
