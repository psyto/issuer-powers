# issuer-powers

What a Token-2022 mint's issuer can do to the people who hold it — read from the mint's
extensions, and graded, so a venue can decide before it lists the mint.

A regulated stock token (xStocks, Ondo) is a Token-2022 mint whose extensions grant the issuer
standing powers over every holder:

- a **permanent delegate** that can move or burn any balance without the holder's signature;
- a **freeze authority** that can lock any account;
- a **pause authority** that can halt every transfer at once;
- a **scaled-UI multiplier** that restates every balance, with a change window;
- a **transfer hook** that runs a program on every transfer;
- a **default account state** that can start new accounts frozen; a **mint close authority**.

This library reads those powers and grades them. No runtime dependencies; `parseIssuerPowers` is
pure, only `readIssuerPowers` does network.

## Install

Not on npm yet — depend on the git repo (the `prepare` script builds it on install):

```sh
npm i github:psyto/issuer-powers
# or pin a commit: npm i github:psyto/issuer-powers#<commit>
```

ESM only. `readIssuerPowers` uses the global `fetch` (Node 18+); on older runtimes pass a `fetch`
as the third argument. `parseIssuerPowers`, `assess` and `diffPowers` need no network at all.

## Use

```ts
import { readIssuerPowers, assess, gating, diffPowers } from "issuer-powers";

const p = await readIssuerPowers("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", RPC); // TSLAx
assess(p).level;   // "custodial" — it has a permanent delegate
assess(p).summary; // "custodial: permanentDelegate=5aMN…FvEq (move or burn any holder's balance); …"
```

| function | |
|---|---|
| `parseIssuerPowers(account)` | pure; takes a `getAccountInfo` `value` in `jsonParsed` encoding (or a bare parsed `info`) and returns an `IssuerPowers` |
| `assess(powers)` | grades the powers; `level` is `custodial` \| `haltable` \| `mutable` \| `benign` (the strongest category present) |
| `gating(powers)` | where the mint gates transfers: `non-transferable` \| `per-transfer` \| `per-holder` \| `latent` \| `boundary` \| `unknown` |
| `diffPowers(expected, actual)` | the fields that changed; pin a mint's powers in CI and catch an issuer silently adding a delegate or changing the hook authority |
| `readIssuerPowers(mint, rpc, fetchFn?)` | fetch the mint over RPC (`jsonParsed`) and parse it |

## What the grades mean

- **custodial** — the issuer can take or move a holder's balance: a permanent delegate.
- **haltable** — the issuer can lock or stop transfers: freeze authority, pause authority, a
  default-frozen account state, or a permissioned-burn authority (co-signs holder burns).
- **mutable** — the issuer can silently change value, supply or transferability: the scaled-UI
  multiplier authority, the transfer-hook authority, the transfer-fee config/withdraw authorities,
  the interest-bearing rate authority, the mint authority (new supply), or the mint close authority.
- **benign** — none of the above.

The grade is a fact about the mint, not a verdict on the issuer. A venue decides what it will
front; this tells it what it is fronting.

## Is it boundary-gated?

A common design for composable regulated tokens checks eligibility only where the token is minted
and redeemed, and lets it move freely between holders. `gating(powers)` says whether a mint
actually works that way, strictest first:

| `model` | meaning |
|---|---|
| `non-transferable` | the token cannot move between holders (NonTransferable) |
| `per-transfer` | a program the issuer chose runs on every move (it may check anything, or nothing) |
| `per-holder` | new accounts start frozen; the issuer thaws each holder |
| `latent` | no gate today, but one signature can add one: the hook authority sets a program, or the freeze authority flips new accounts to frozen |
| `boundary` | none of the above: nothing is checked on transfer |
| `unknown` | no gate found, but the mint could not be fully read (unparseable extension, unknown token program) |

```ts
gating(p); // { model: "latent", reasons: ["transferHook authority=5aMN…FvEq can set a per-transfer program",
           //   "freezeAuthority=JDq1…xJNs can flip defaultAccountState to frozen"] }
```

Both the xStocks and Ondo mints in the fixtures are `latent`: they move freely today, and each
keeps a hook authority and a freeze authority that could gate every transfer, or every new holder,
later. A legacy SPL mint such as USDC has neither extension and reads `boundary`. `reasons` lists
every gate that applies, not only the strictest. `gating` only covers ordinary
transfers — a `boundary` mint can still carry a freeze authority, a pause authority or a
permanent delegate, which `assess` reports. Pin the hook authority with `diffPowers` if you rely
on a mint staying ungated.

For drift detection, `diffPowers` goes further than the named fields above: it compares every
authority/delegate field across *all* of a mint's extensions (`extensionAuthorities`), so a
rotation in an extension this library does not yet model by name is still caught.

## Used in

I use this in a front-end that gates tokenized-stock swaps: it pins every stock mint's
`issuer-powers` profile, so an issuer changing a mint's powers (adding a delegate, rotating the
hook authority) breaks CI via `diffPowers` before a swap is built against that mint. A pause is
operational rather than a posture change, so `diffPowers` ignores it; the live check asserts
`paused === false` on its own. In that set, xStocks mints grade `custodial` (a permanent
delegate) and Ondo mints grade `haltable` (freeze only, no delegate).

The companion harness [issuer-drill](https://github.com/psyto/issuer-drill) shows what one of
these powers — the permanent delegate — does to a live lending market when it is used:
[Kamino-Finance/klend#95](https://github.com/Kamino-Finance/klend/issues/95). `issuer-powers` is
the static profile; `issuer-drill` is the dynamic proof.

## License

Apache-2.0.
