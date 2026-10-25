/**
 * isLoopbackAddress decides whether an IP address names this machine: all of 127.0.0.0/8, ::1 and the IPv6 forms
 * that map an IPv4 loopback address. A host name, a bracketed literal or an empty string is no address at all.
 */
import { isLoopbackAddress } from "./ip-address.util";

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
