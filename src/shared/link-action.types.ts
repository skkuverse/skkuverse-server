export type LinkPolicy = {
  webview: "own-origin" | "any-https";
  isKnownMiniAppTarget(value: string): boolean;
  isAllowedRoute(value: string): boolean;
};

export type LinkProblem = "unknown-miniapp-target" | "not-https-url" | "not-webview-url" | "route-not-allowed";
