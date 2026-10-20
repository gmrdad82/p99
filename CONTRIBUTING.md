# Contributing to P99

Issues and pull requests are welcome at [github.com/gmrdad82/p99](https://github.com/gmrdad82/p99). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says, never in a public issue.

## The Contributor Licence Agreement

P99 is offered under the AGPL-3.0 and under a commercial licence ([README](README.md#licence)). So that both stay possible, a pull request is merged only once its author has signed the [P99 Individual Contributor Licence Agreement](CLA.md). You keep the copyright in your work; the agreement lets Cătălin Ilinca license it as part of P99 under any licence, and always under the licence P99 uses on the day you submit it. It is adapted from the Harmony Individual Contributor License Agreement 1.0; read it before you sign.

Sign it once, in your first pull request:

1. Write this statement in the pull request's description, with your full legal name, your GitHub account and the date:

   > I have read the P99 Individual Contributor Licence Agreement, version 1.0, in CLA.md, and I agree to its terms for this Contribution and for every Contribution I Submit to P99 from now on.
   >
   > Name: <full legal name>
   > GitHub: <account>
   > Date: <YYYY-MM-DD>

2. Add one row to the table in [CLA-SIGNERS.md](CLA-SIGNERS.md), in the same pull request: your name, your GitHub account, the date and the agreement's version.

Later pull requests need neither. If you contribute for an employer, have them approve the agreement first (CLA.md, Section 3(c)).

## What a change needs

- **The gate green:** `bin/gate --fast` (formatting, clippy with warnings as errors, and the unit tests), and `cd worker && npm ci && npm test` when the Worker changes.
- **The loader under its budget:** `bin/budget` keeps it under 2,048 bytes gzipped; anything new for the browser loads lazily.
- **Only permissive code from elsewhere:** code you port or copy comes from MIT, Apache-2.0, BSD, ISC or zlib sources; never GPL, LGPL, AGPL or other copyleft code. Credit each origin with its version or commit, its copyright and its licence text in [NOTICE](NOTICE) where its licence asks.
- **No comments in code;** match the surrounding style.
- **Small changes,** with a pull request message that says what P99 can now do, in a plain sentence.
