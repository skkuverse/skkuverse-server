/**
 * The address policy inside the socket's own DNS lookup (security fix): a hostname connects only when every address
 * it resolves to is public, so a rebinding answer or one private address among public ones is refused.
 */
import { createGuardedLookup } from "./guarded-lookup.util";
import { OutboundBlockedError } from "./outbound-blocked.error";

describe("createGuardedLookup", () => {
  function fakeResolver(addresses: { address: string; family: number }[]) {
    return jest.fn((_host: string, _opts: unknown, cb: (err: null, a: typeof addresses) => void) =>
      cb(null, addresses),
    );
  }

  it("passes through when every address is public (single-address form)", (done) => {
    // Act
    const lookup = createGuardedLookup(fakeResolver([{ address: "115.145.129.35", family: 4 }]));

    // Assert
    lookup("www.skku.edu", {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("115.145.129.35");
      expect(family).toBe(4);
      done();
    });
  });

  it("returns the full list when the caller asks for all addresses", (done) => {
    // Arrange
    const list = [
      { address: "115.145.129.35", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ];

    // Act
    const lookup = createGuardedLookup(fakeResolver(list));

    // Assert
    lookup("www.skku.edu", { all: true }, (err, address) => {
      expect(err).toBeNull();
      expect(address).toEqual(list);
      done();
    });
  });

  it.each(["127.0.0.1", "172.18.0.3", "169.254.169.254", "::1"])(
    "rejects a hostname resolving to %s",
    (ip, done: jest.DoneCallback) => {
      // Act
      const lookup = createGuardedLookup(fakeResolver([{ address: ip, family: ip.includes(":") ? 6 : 4 }]));

      // Assert
      lookup("rebound.skku.edu", {}, (err) => {
        expect(err).toBeInstanceOf(OutboundBlockedError);
        done();
      });
    },
  );

  it("rejects when any one of several addresses is private", (done) => {
    // Act
    const lookup = createGuardedLookup(
      fakeResolver([
        { address: "115.145.129.35", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    );

    // Assert
    lookup("mixed.skku.edu", {}, (err) => {
      expect(err).toBeInstanceOf(OutboundBlockedError);
      done();
    });
  });
});
