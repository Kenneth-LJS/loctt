# Security

## The security model, in one line

LocTT is **single-user and local-first**: the web server binds to
`127.0.0.1` only, there is no authentication and no multi-user model, and
your data stays on your machine unless you enable optional Git Sync. There
is no login to secure because nothing is exposed on the network.

This is a deliberate trade for zero-setup simplicity — see
[README → Security & data model](README.md#security--data-model).

## Using it safely

- **Do not bind LocTT to `0.0.0.0` or put it behind a reverse proxy.** It
  assumes it is alone on a trusted machine and has no auth layer to
  protect it if exposed. `npm run dev:host` exposes only the Vite dev
  client (for testing on a local device); the API server stays on
  loopback.
- **Treat `.loctt/` as your data.** It is plain files (YAML + markdown);
  back it up as you would any working directory. Git Sync is opt-in and
  publishes only to the branch you configure.
- **The realistic threat is corrupted data, not attackers.** LocTT
  degrades around a corrupt field instead of crashing; run
  `loctt doctor` to see what it finds.

## Reporting a vulnerability

If you find a security issue, please report it privately to the
maintainer rather than opening a public issue: **kenneth_ljs@live.com**.
Include what you found, how to reproduce it, and the impact you see.
You'll get an acknowledgement, and a fix or an explanation of why the
behaviour is intended (for example, the loopback-only posture above).
