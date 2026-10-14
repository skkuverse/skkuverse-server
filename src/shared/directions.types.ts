export type DirectionsProvider = "naver" | "tmap";

// WHY: "auth" is a revoked or wrong key (401/403), which no retry fixes; "api" an HTTP 200 whose body reports a
// failure; "implausible" a route the clients' plausibility checks refuse.
export type DirectionsFailure = "auth" | "http" | "timeout" | "reset" | "network" | "api" | "implausible";
