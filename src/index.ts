/**
 * issuer-powers — what a Token-2022 mint's issuer can do to the people who hold it.
 *
 * A regulated stock token (xStocks, Ondo) is a Token-2022 mint whose extensions grant the issuer
 * standing powers over every holder: a permanent delegate that can move or burn any balance, a
 * freeze authority that can lock any account, a pause authority that can halt all transfers, a
 * scaled-UI multiplier that silently restates balances, a transfer hook that can gate every move.
 * Before a venue lists such a mint, it should know which of these powers the mint actually carries.
 *
 * This library reads those powers from the mint account (the same `jsonParsed` shape an RPC
 * returns) and grades them. It has no runtime dependencies and does its own HTTP only in
 * `readIssuerPowers`; `parseIssuerPowers` is pure.
 *
 * The companion harness https://github.com/psyto/issuer-drill shows what one of these powers (the
 * permanent delegate) does to a live lending market: Kamino-Finance/klend#95.
 */

export type TokenProgram = "token-2022" | "spl-token" | "unknown";

export type AccountState = "initialized" | "frozen" | "uninitialized";

export interface ScaledUiAmount {
  /** Who may change the multiplier (restating every holder's balance). */
  authority: string | null;
  multiplier: string;
  newMultiplier: string;
  newMultiplierEffectiveTimestamp: number;
}

/** The standing powers an issuer holds over a Token-2022 mint, read from its extensions. */
export interface IssuerPowers {
  mint: string | null;
  tokenProgram: TokenProgram;
  decimals: number | null;
  mintAuthority: string | null;
  /** Freeze any token account of this mint. */
  freezeAuthority: string | null;
  /** Move or burn tokens from any account without the holder's signature. */
  permanentDelegate: string | null;
  /** Halt every transfer of the mint at once (Token-2022 Pausable). */
  pausable: { authority: string | null; paused: boolean } | null;
  /** New token accounts start in this state; `frozen` means holders are gated by default. */
  defaultAccountState: AccountState | null;
  /** Close the mint account itself (MintCloseAuthority). */
  closeAuthority: string | null;
  /** Restate every balance by a multiplier the authority can change (ScaledUiAmount). */
  scaledUiAmount: ScaledUiAmount | null;
  /** Confidential-transfer configuration authority. */
  confidentialTransfer: { authority: string | null } | null;
  /** A program run on every transfer; the authority can set or change it (TransferHook). */
  transferHook: { authority: string | null; programId: string | null } | null;
  /** Every extension name present on the mint, in the order the RPC reported them. */
  extensions: string[];
}

export type PowerLevel = "custodial" | "haltable" | "mutable" | "benign";

export interface Assessment {
  /** The strongest category of power present. */
  level: PowerLevel;
  /** Powers that let the issuer take or move a holder's balance: permanent delegate. */
  custodial: string[];
  /** Powers that let the issuer lock or stop transfers: freeze, pause, default-frozen. */
  haltable: string[];
  /** Powers that silently change value or transferability: scaled-UI, transfer hook, mint close. */
  mutable: string[];
  /** One-line, human-readable summary. */
  summary: string;
}

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return typeof v === "object" && v !== null ? (v as Json) : null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A decimal that an RPC may serialize as a string or (rarely) a number. */
function asNumStr(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Dig from a `getAccountInfo` `value` (or a bare parsed `info`) to the mint's parsed info. */
function mintInfo(account: unknown): { info: Json; program: string | null } {
  const root = asObj(account);
  if (!root) throw new Error("issuer-powers: account is not an object");
  // A full getAccountInfo value: { data: { parsed: { info, type }, program }, owner, ... }
  const data = asObj(root.data);
  if (data) {
    const parsed = asObj(data.parsed);
    if (parsed) {
      // jsonParsed labels a mint "mint" and a token account "account"; grading a token account as
      // a mint would silently report "no powers", so refuse anything that is not a mint.
      if (parsed.type !== undefined && parsed.type !== "mint")
        throw new Error(`issuer-powers: account is a "${String(parsed.type)}", not a mint`);
      const info = asObj(parsed.info);
      if (info) return { info, program: asStr(data.program) ?? asStr(root.owner) };
    }
  }
  // Already a parsed `info`. A mint has `decimals` as a top-level number; a token account keeps its
  // decimals inside `tokenAmount`, so a top-level numeric `decimals` is what tells the two apart.
  if (typeof root.decimals === "number") return { info: root, program: null };
  throw new Error("issuer-powers: no parsed mint info found (expected a jsonParsed mint account)");
}

function tokenProgramOf(program: string | null): TokenProgram {
  if (program === "spl-token-2022" || program === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") return "token-2022";
  if (program === "spl-token" || program === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") return "spl-token";
  return "unknown";
}

function extState(info: Json, name: string): Json | null {
  const exts = Array.isArray(info.extensions) ? info.extensions : [];
  for (const e of exts) {
    const eo = asObj(e);
    if (eo && eo.extension === name) return asObj(eo.state) ?? {};
  }
  return null;
}

/** Parse the issuer powers out of a mint account (jsonParsed). Pure; no network. */
export function parseIssuerPowers(account: unknown): IssuerPowers {
  const { info, program } = mintInfo(account);
  const exts = Array.isArray(info.extensions) ? info.extensions : [];
  const names = exts.map((e) => asObj(e)?.extension).filter((n): n is string => typeof n === "string");

  const scaled = extState(info, "scaledUiAmountConfig");
  const pausable = extState(info, "pausableConfig");
  const defState = extState(info, "defaultAccountState");
  const conf = extState(info, "confidentialTransferMint");
  const hook = extState(info, "transferHook");
  const permDel = extState(info, "permanentDelegate");
  const closeAuth = extState(info, "mintCloseAuthority");

  const dec = info.decimals;
  const ts = scaled ? (scaled.newMultiplierEffectiveTimestamp as unknown) : undefined;

  return {
    mint: asStr(info.mint) ?? (typeof extState(info, "tokenMetadata")?.mint === "string" ? (extState(info, "tokenMetadata")!.mint as string) : null),
    tokenProgram: tokenProgramOf(program),
    decimals: typeof dec === "number" ? dec : null,
    mintAuthority: asStr(info.mintAuthority),
    freezeAuthority: asStr(info.freezeAuthority),
    permanentDelegate: permDel ? asStr(permDel.delegate) : null,
    pausable: pausable ? { authority: asStr(pausable.authority), paused: pausable.paused === true } : null,
    defaultAccountState: defState ? ((asStr(defState.accountState) as AccountState | null) ?? null) : null,
    closeAuthority: closeAuth ? asStr(closeAuth.closeAuthority ?? closeAuth.authority) : null,
    scaledUiAmount: scaled
      ? {
          authority: asStr(scaled.authority),
          multiplier: asNumStr(scaled.multiplier) ?? "1",
          newMultiplier: asNumStr(scaled.newMultiplier) ?? (asNumStr(scaled.multiplier) ?? "1"),
          newMultiplierEffectiveTimestamp: typeof ts === "number" ? ts : 0,
        }
      : null,
    confidentialTransfer: conf ? { authority: asStr(conf.authority) } : null,
    transferHook: hook ? { authority: asStr(hook.authority), programId: asStr(hook.programId) } : null,
    extensions: names,
  };
}

const short = (k: string | null): string => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "none");

/** Grade the powers. The level is the strongest category present. */
export function assess(p: IssuerPowers): Assessment {
  const custodial: string[] = [];
  const haltable: string[] = [];
  const mutable: string[] = [];

  if (p.permanentDelegate) custodial.push(`permanentDelegate=${short(p.permanentDelegate)} (move or burn any holder's balance)`);
  if (p.freezeAuthority) haltable.push(`freezeAuthority=${short(p.freezeAuthority)} (freeze any account)`);
  if (p.pausable?.authority) haltable.push(`pauseAuthority=${short(p.pausable.authority)} (halt all transfers${p.pausable.paused ? ", currently PAUSED" : ""})`);
  if (p.defaultAccountState === "frozen") haltable.push("defaultAccountState=frozen (new accounts start frozen)");
  if (p.scaledUiAmount?.authority) mutable.push(`scaledUiAmount authority=${short(p.scaledUiAmount.authority)} (restate every balance)`);
  if (p.transferHook?.authority) mutable.push(`transferHook authority=${short(p.transferHook.authority)} (set a program on every transfer${p.transferHook.programId ? `, currently ${short(p.transferHook.programId)}` : ""})`);
  if (p.confidentialTransfer?.authority) mutable.push(`confidentialTransfer authority=${short(p.confidentialTransfer.authority)} (configure confidential transfers)`);
  if (p.closeAuthority) mutable.push(`closeAuthority=${short(p.closeAuthority)} (close the mint)`);

  const level: PowerLevel = custodial.length ? "custodial" : haltable.length ? "haltable" : mutable.length ? "mutable" : "benign";
  const summary =
    level === "benign"
      ? "no standing issuer powers over holders"
      : `${level}: ${[...custodial, ...haltable, ...mutable].join("; ")}`;
  return { level, custodial, haltable, mutable, summary };
}

/**
 * The drift-relevant posture of a mint: which powers exist and who holds them. It deliberately
 * leaves out values that move in normal operation — the current and pending scaled-UI multiplier
 * and its timestamp (these tokens rebase), and the live `paused` flag — so a pin tracks authority
 * and power changes, not routine churn.
 */
function posture(p: IssuerPowers): Record<string, unknown> {
  return {
    tokenProgram: p.tokenProgram,
    decimals: p.decimals,
    mintAuthority: p.mintAuthority,
    freezeAuthority: p.freezeAuthority,
    permanentDelegate: p.permanentDelegate,
    closeAuthority: p.closeAuthority,
    defaultAccountState: p.defaultAccountState,
    pausable: p.pausable ? { authority: p.pausable.authority } : null,
    scaledUiAmount: p.scaledUiAmount ? { authority: p.scaledUiAmount.authority } : null,
    confidentialTransfer: p.confidentialTransfer ? { authority: p.confidentialTransfer.authority } : null,
    transferHook: p.transferHook ? { authority: p.transferHook.authority, programId: p.transferHook.programId } : null,
    extensions: [...p.extensions].sort(),
  };
}

/**
 * Posture fields in `actual` that differ from `expected`. Use it in CI to pin a mint and catch an
 * issuer silently adding a delegate, rotating the mint authority, or changing the hook or scaled-UI
 * authority. It ignores operational churn (the multiplier value, the pause flag), so it does not
 * cry wolf on a rebase. Returns an empty array when the two postures agree.
 */
export function diffPowers(expected: IssuerPowers, actual: IssuerPowers): string[] {
  const e = posture(expected);
  const a = posture(actual);
  const j = (v: unknown) => JSON.stringify(v);
  const out: string[] = [];
  for (const k of Object.keys(e)) {
    if (j(e[k]) !== j(a[k])) out.push(`${k}: expected ${j(e[k])}, got ${j(a[k])}`);
  }
  return out;
}

/** Read a mint account over RPC (jsonParsed) and parse its issuer powers. */
export async function readIssuerPowers(mint: string, rpc: string, fetchFn: typeof fetch = fetch): Promise<IssuerPowers> {
  const res = await fetchFn(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] }),
  });
  if (!res.ok) throw new Error(`issuer-powers: RPC ${res.status} for ${mint}`);
  const body = (await res.json()) as { result?: { value?: unknown }; error?: { message?: string } };
  if (body.error) throw new Error(`issuer-powers: RPC error for ${mint}: ${body.error.message ?? "unknown"}`);
  const value = body.result?.value;
  if (!value) throw new Error(`issuer-powers: mint ${mint} not found`);
  return parseIssuerPowers(value);
}
