/**
 * isLoopbackAddress decides whether an IP address names this machine: all of 127.0.0.0/8, ::1 and the IPv6 forms
 * that map an IPv4 loopback address. isPublicAddress refuses every special-purpose address an outbound request must
 * never reach (a security fix). A host name, a bracketed literal or an empty string is no address at all.
 */
import { isLoopbackAddress, isPublicAddress } from "./ip-address.util";

describe("isLoopbackAddress", () => {
  it.each(["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"])("is true for %s", (address) => {
    // Act & Assert
    expect(isLoopbackAddress(address)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "128.0.0.1", "126.255.255.255", "10.0.0.1", "192.168.0.10", "::ffff:192.168.0.10", "::2", "localhost", "[::1]", ""])(
    "is false for %j",
    (address) => {
      // Act & Assert
      expect(isLoopbackAddress(address)).toBe(false);
    },
  );
});

describe("isPublicAddress", () => {
  it.each(["115.145.129.35", "8.8.8.8", "2001:4860:4860::8888"])("public: %s", (ip) => {
    // Act & Assert
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.18.0.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "::1",
    "::",
    "::7f00:1",
    "fec0::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "not-an-ip",
  ])("blocked: %s", (ip) => {
    // Act & Assert
    expect(isPublicAddress(ip)).toBe(false);
  });
});
