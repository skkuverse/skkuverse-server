/**
 * The attachment proxy's URL policy (security fix): an http or https URL on the default port, without userinfo, whose
 * host is one of the caller's domains or under one; anything else is refused before any request is made.
 */
import { isAllowedHost, parseAllowedUrl } from "./outbound-url.util";

const SKKU_DOMAINS = ["skku.edu", "skkumed.ac.kr"] as const;

describe("isAllowedHost", () => {
  it.each(["skku.edu", "www.skku.edu", "nano.skku.edu", "www.skkumed.ac.kr", "WWW.SKKU.EDU", "www.skku.edu."])(
    "allows %s",
    (host) => {
      // Act & Assert
      expect(isAllowedHost(host, SKKU_DOMAINS)).toBe(true);
    },
  );

  it.each(["evilskku.edu", "skku.edu.evil.com", "xskkumed.ac.kr", "example.com", "127.0.0.1", ""])(
    "rejects %s",
    (host) => {
      // Act & Assert
      expect(isAllowedHost(host, SKKU_DOMAINS)).toBe(false);
    },
  );
});

describe("parseAllowedUrl", () => {
  it.each([
    "https://www.skku.edu/_attach/a.pdf",
    "http://bio.skku.edu/board/view?id=1",
    "https://www.skku.edu:443/x",
  ])("accepts %s", (url) => {
    // Act & Assert
    expect(parseAllowedUrl(url, SKKU_DOMAINS)).not.toBeNull();
  });

  it.each([
    "https://evilskku.edu/x",
    "https://www.skku.edu:8080/x",
    "https://user:pw@www.skku.edu/x",
    "http://127.0.0.1:3000/",
    "http://api-2:3000/robots.txt",
    "http://169.254.169.254/opc/v1/instance/",
    "file:///etc/passwd",
    "ftp://www.skku.edu/x",
    "data:text/html,<script>alert(1)</script>",
    "not a url",
  ])("rejects %s", (url) => {
    // Act & Assert
    expect(parseAllowedUrl(url, SKKU_DOMAINS)).toBeNull();
  });
});
