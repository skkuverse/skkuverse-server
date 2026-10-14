export const SEOUL_BUS_API_URL = "http://ws.bus.go.kr/api/rest";

// WHY: two-digit codes as Seoul names village buses, so `jongro_locations_07` has no `_007` twin.
export const JONGRO_ROUTE_ID_PATTERN = /^jongro(0[1-9]|[1-9]\d+)$/;

export const JONGRO_ROUTE_ID_PREFIX = "jongro";
