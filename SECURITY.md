# Security

Depthwatch indexes public chain data and serves numbers: it holds no keys, no funds and no user
accounts. A security issue is still anything that lets an input make the API, the dashboard, the
CLI or the database do something other than that; for example a pool id or query parameter that
reaches SQL unescaped, a path that `depthwatch serve` should not serve, an RPC response that
crashes or hangs the indexer, or a vulnerable dependency in the lockfile.

## Reporting a vulnerability

Please do not open a public issue or pull request for a security problem: details posted there are
visible before a fix exists.

Report it privately through GitHub's vulnerability reporting form for this repository, the
"Report a vulnerability" button on the Security tab:

https://github.com/0xdeni/depthwatch/security/advisories/new

If that page says private reporting is not enabled, open an issue that says only that you have a
security report and would like a private channel, with no details; a maintainer replies with one.

Include what any bug report needs (the command or request, the pool id and block number where
relevant, what happened and what you expected), the impact as you understand it and, if you have
one, a fixture or test that reproduces it offline.

## What to expect

A maintainer acknowledges the report, works out the fix with you where that helps, and credits you
in the release that ships it unless you ask otherwise. Depthwatch is pre-1.0 and under active
development (see [README.md](README.md)).
