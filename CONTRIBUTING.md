# Contributing

Small, focused contributions are welcome. The useful ones:

- **A new Token-2022 power.** If a mint extension grants the issuer a holder-facing power this
  library does not yet model by name, add it to `parseIssuerPowers` and `assess` with a test and a
  real `jsonParsed` fixture. (Authority *rotations* in any extension are already caught generically
  by `diffPowers`; this is about naming and grading a power.)
- **A grading correction.** If a power is placed in the wrong category — `custodial` (move/seize a
  balance) vs `haltable` (lock/stop transfers) vs `mutable` (change value, supply or
  transferability) — open an issue with the extension and what it can actually do.
- **Parsing fixes.** If a `state` field name or extension tag is wrong against the validator's
  `jsonParsed` output, a fix with a fixture is the most valuable thing here.

## Running

```sh
npm install
npm test          # vitest, offline, against fixtures
npm run build     # tsc -> dist
```

## Ground rules

- **No runtime dependencies.** Keep the library zero-dep; `parseIssuerPowers`/`assess`/`diffPowers`
  must stay pure (no network), and only `readIssuerPowers` may touch the network.
- **Fixtures are real.** Test against actual mainnet `jsonParsed` mint accounts, not hand-written
  shapes, wherever a claim about parsing is made.
- **The grade is a fact, not a verdict.** Describe what a power lets the issuer do; do not editorialize
  about a particular issuer.

By contributing you agree your contribution is licensed under Apache-2.0, matching the repo.
