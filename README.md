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

```ts
import { readIssuerPowers, assess, diffPowers } from "issuer-powers";

const p = await readIssuerPowers("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", RPC); // TSLAx
assess(p).level;   // "custodial" — it has a permanent delegate
assess(p).summary; // "custodial: permanentDelegate=5aMN…HFvEq (move or burn any holder's balance); …"
```

| function | |
|---|---|
| `parseIssuerPowers(account)` | pure; takes a `getAccountInfo` `value` in `jsonParsed` encoding (or a bare parsed `info`) and returns an `IssuerPowers` |
| `assess(powers)` | grades the powers; `level` is `custodial` \| `haltable` \| `mutable` \| `benign` (the strongest category present) |
| `diffPowers(expected, actual)` | the fields that changed; pin a mint's powers in CI and catch an issuer silently adding a delegate or changing the hook authority |
| `readIssuerPowers(mint, rpc, fetchFn?)` | fetch the mint over RPC (`jsonParsed`) and parse it |

## What the grades mean

- **custodial** — the issuer can take or move a holder's balance: a permanent delegate.
- **haltable** — the issuer can lock or stop transfers: freeze authority, pause authority, or a
  default-frozen account state.
- **mutable** — the issuer can silently change value or transferability: the scaled-UI multiplier,
  the transfer-hook authority, or a mint close authority.
- **benign** — none of the above.

The grade is a fact about the mint, not a verdict on the issuer. A venue decides what it will
front; this tells it what it is fronting.

## Used by

- [prebell](https://github.com/psyto) pins every stock mint it fronts to a recorded
  `issuer-powers` profile, so an issuer changing a mint's powers (adding a delegate, moving the
  hook authority, flipping the pause) breaks CI before prebell builds a swap against it.

The companion harness [issuer-drill](https://github.com/psyto/issuer-drill) shows what one of
these powers — the permanent delegate — does to a live lending market when it is used:
[Kamino-Finance/klend#95](https://github.com/Kamino-Finance/klend/issues/95). `issuer-powers` is
the static profile; `issuer-drill` is the dynamic proof.

## License

Apache-2.0.
