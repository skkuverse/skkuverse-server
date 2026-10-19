/**
 * firstPartyOrigin: which startUrls this server fetches a manifest for. Only an
 * https origin on the first-party list counts, matched whole, so a lookalike
 * host, a plain-http page or a third party is never fetched.
 */
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../../infra/origins";
import { firstPartyOrigin } from "./miniapps-manifest.rules";

describe("firstPartyOrigin", () => {
  it("accepts a startUrl on a first-party mini-app origin", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://mukja.mini.skkuverse.com/", FIRST_PARTY_MINIAPP_ORIGINS)).toBe(
      "https://mukja.mini.skkuverse.com",
    );
    expect(firstPartyOrigin("https://booth-box.mini.skkuverse.com/some/page", FIRST_PARTY_MINIAPP_ORIGINS)).toBe(
      "https://booth-box.mini.skkuverse.com",
    );
  });

  it("rejects http (https only)", () => {
    // Act & Assert
    expect(firstPartyOrigin("http://mukja.mini.skkuverse.com/", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });

  it("rejects a third-party host", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://student.skku.edu/student/notice2.do", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });

  it("accepts ESKARA's first-party host, whose shape differs (.miniapp., not .mini.)", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://eskara.miniapp.skkuverse.com/eskara", FIRST_PARTY_MINIAPP_ORIGINS)).toBe(
      "https://eskara.miniapp.skkuverse.com",
    );
  });

  it("rejects a *.mini.skkuverse.com host that is not on the list", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://unlisted.mini.skkuverse.com/", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });

  it("rejects the webview SPA, which is not a mini app", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://webview.skkuverse.com/eskara", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });

  it("rejects a host that merely ends with the right suffix", () => {
    // Act & Assert
    expect(firstPartyOrigin("https://mukja.mini.skkuverse.com.evil.com/", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });

  it("rejects a malformed URL", () => {
    // Act & Assert
    expect(firstPartyOrigin("not a url", FIRST_PARTY_MINIAPP_ORIGINS)).toBeNull();
  });
});
