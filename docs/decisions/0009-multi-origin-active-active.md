---
title: Multiple Origins, Active-Active, Behind Cloudflare Load Balancing
type: adr
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-10-27
audience: internal
---

# 0009. Multiple Origins, Active-Active, Behind Cloudflare Load Balancing

> How `api.skkuverse.com` scales out to a second origin host, and why that way. Dormant: one origin (`oracle`) since 2026-10-03; this is the design the next scale-out starts from. Decided 2026-09-24.

## Context

- In September 2026 the one OCI VM measured about 1,990 req/s against an estimated festival peak of about 700. Capacity was not the risk; one VM, one provider and one region were.
- Every public host name is proxied by Cloudflare, and the origins accept 80/443 only from Cloudflare's ranges, by a host firewall configured outside this repository.
- From 2026-09-25 to 2026-10-03 a rented second host served behind a load balancer. It was returned, and the load balancer and the add-on were removed. How it was configured and how to re-create it is kept with the maintainer's operations records, outside this repository.

## Decision

**The Cloudflare Load Balancing add-on on the Free plan, one pool, every origin active.** Priced per endpoint ($5/month for two, +$5 each further endpoint, as of 2026-09).

- One pool holds every origin and is both default and fallback. Random steering with weights; a new host enters at a low weight and ramps while nginx 5xx, the heartbeat and Atlas ops are watched.
- The monitor reads `GET /health/ready` and requires the body `ready`, so a proxy error page with status 200 counts as down.
- Every host runs the same compose file, nginx site, firewall and deploy (then `deploy.yml` ran `deploy-host.yml` once per host; since 2026-10-26 the deploy runs outside this repository). Hosts of different sizes are balanced by weight, never by per-host compose files. nginx stamps `X-Served-By: <hostname>` on every response.
- **One poller, on one host, until leader election.** Every replica reads the shared `bus_cache`, so one poller serves every host. Each host declares `POLLER_ROLE=active|standby` in a host env file; the deploy and the heartbeat fail on a missing or invalid file. Moving the poller is manual: stop it on one host, then start it on the other. Exactly one poller is also what [ADR 0012](0012-runtime-roles.md) assumes.
- The existing A record stays as the rollback: disabling the load balancer returns to it.

Rejected front doors:

- Two A records and a DNS flip: no health checks, a flip we would have to automate (about 4 minutes), blind to a host that is up with a dead app.
- Cloudflare Tunnel alone: tunnel replicas give connector HA only; health-aware failover still needs the add-on.
- Workers-based failover: the Free plan caps at 100k requests/day, and it puts our code on every request.
- OCI's free load balancer: 10 Mbps, and it sits inside the failure domain we are leaving.
- Route 53, Fly.io, k3s: incompatible with the Cloudflare proxy as set up, or a migration.
- Cloudflare Pro: it does not include Load Balancing and does not shorten the monitor interval (60 s on Free; shorter is a paid add-on option).

Rejected: primary/standby. A standby's CPU idles, it is unproven until the failover and can rot unnoticed, and a connection failure waits for the monitor instead of being retried on another endpoint.

### Next steps before a second host (Phase B)

- Leader election for the poller: a lease document in MongoDB, expiry from the database clock, renewed every 10 s with a 30 s TTL, the holder stepping down on its own monotonic clock before the lease can lapse. Then `POLLER_ROLE` and the manual fail-over go away.
- Images built once per architecture in CI and pulled by hosts; a deploy drains a host (weight 0) before restarting it.
- Optional: a Tunnel per host as its endpoint, a shared rate-limit store, load-balancer alerts to Discord.

## Consequences

- A host that refuses connections costs users nothing: zero-downtime failover retries those requests on another endpoint. A host that answers 5xx is removed only by the monitor, so a share of requests fails for a few minutes.
- If the poller's host fails, bus realtime data goes empty within the `bus_cache` TTL while everything else keeps serving, until someone moves the poller. The heartbeat alert is the trigger; leader election removes the gap.
- If every host is unhealthy (an Atlas outage), the fallback pool is the same pool, so traffic still reaches the hosts, as with one host.
- **Rate limits loosen by the host count**: each process counts on its own.
- **Atlas load scales with processes**, not only with traffic: twice the replicas, twice the connection pools and idle ops (estimated about 7 ops/s and 90 of 500 connections for two hosts, inside the Flex tier).
- A mistake on a new host reaches users at once; the weight ramp and checking the host alone first mitigate it.

## Rollout notes

- **Origin-path stalls.** Some requests stalled for seconds between certain Cloudflare locations and the origins, on every origin alike, while the hosts were idle. The app's request timeouts were shortened. Evaluating Tunnel endpoints against direct ones is still open.
- The rented host ran with production's `.env`, an accepted risk for the rental, and those credentials stayed valid after it was returned.
- The drill lessons (a re-enabled endpoint serves only after its next monitor check, a pool edit needs a second confirmation, starting a poller runs a full building sync) are kept with the maintainer's operations records.
