# Security policy

## Reporting a vulnerability

Please report a vulnerability privately. Do not open a public issue or pull request for it.

- **GitHub:** open a private report from this repository's **Security** tab ("Report a vulnerability"). This is the preferred channel.
- **Email:** [team@skkuverse.com](mailto:team@skkuverse.com).

Include what you found, where (a route, a file or a commit), how to reproduce it, and what an attacker could do with it. Please test only against your own local server (see the [README](README.md)), never against the production API or other people's data.

## What happens next

- We aim to acknowledge a report within a few days.
- We fix the problem privately, release the fix, and then publish it. A fix to public code may go through a private GitHub security advisory before it appears here.
- We credit you in the advisory if you want to be credited.

There is no bug bounty.

## Scope

In scope: the code in this repository and the API it serves.

Out of scope: denial-of-service and volume testing, social engineering, and reports that only list missing headers or best practices without a way to exploit them.
