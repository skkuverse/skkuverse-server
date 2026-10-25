/**
 * AppConfigService.getConfig, the /app/config body: the platform gates from boot-time values and the
 * origins from src/infra/origins.ts, in the order installed apps were served them, with no `features`
 * key since the app's one kill switch is retired.
 */
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import { AppConfigService } from "./app-config.service";

describe("AppConfigService.getConfig", () => {
  it("serves the gates and the origins, and no features key", async () => {
    // Act
    const body = await new AppConfigService().getConfig();

    // Assert
    expect(Object.keys(body)).toEqual(["ios", "android", "webview", "web", "miniapps", "games"]);
    expect(body.webview.bridgeOrigins).toEqual([...BRIDGE_ORIGINS]);
    expect(body.web.origin).toBe(WEB_ORIGIN);
    expect(body.miniapps.origins).toEqual({ ...MINIAPP_ID_BY_FIRST_PARTY_ORIGIN });
    expect(body.games?.origins).toEqual({ ...GAME_ID_BY_FIRST_PARTY_ORIGIN });
  });
});
