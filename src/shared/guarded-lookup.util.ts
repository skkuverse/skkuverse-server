import dns from "node:dns";
import { isPublicAddress } from "./ip-address.util";
import { OutboundBlockedError } from "./outbound-blocked.error";

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: dns.LookupAddress[],
  ) => void,
) => void;

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

type GuardedLookup = (
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
) => void;

// WHY: every address must be public, not just the first: the socket may connect to any of them.
export function createGuardedLookup(
  resolve: Resolver = dns.lookup as unknown as Resolver,
): GuardedLookup {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, []);
        return;
      }
      const blocked = addresses.find((a) => !isPublicAddress(a.address));
      const [first] = addresses;
      if (!first || blocked) {
        callback(
          new OutboundBlockedError(
            `${hostname} resolves to a non-public address`,
          ),
          [],
        );
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}
