import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assess, diffPowers, gating, parseIssuerPowers, readIssuerPowers, type IssuerPowers } from "../src/index.js";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/mints.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const NVDAON = "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo"; // Ondo
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"; // xStocks

const ondo = parseIssuerPowers(fx[NVDAON]);
const xstock = parseIssuerPowers(fx[NVDAX]);

// Clone a fixture account and tamper it the way a real mint change would appear, then re-parse —
// so the drift tests exercise the real parse path, not hand-edited IssuerPowers objects.
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
function withExtState(mint: string, ext: string, patch: Record<string, unknown>): IssuerPowers {
  const a = clone(fx[mint]) as { data: { parsed: { info: { extensions: { extension: string; state: Record<string, unknown> }[] } } } };
  const e = a.data.parsed.info.extensions.find((x) => x.extension === ext)!;
  Object.assign(e.state, patch);
  return parseIssuerPowers(a);
}
function withInfo(mint: string, patch: Record<string, unknown>): IssuerPowers {
  const a = clone(fx[mint]) as { data: { parsed: { info: Record<string, unknown> } } };
  Object.assign(a.data.parsed.info, patch);
  return parseIssuerPowers(a);
}

describe("parseIssuerPowers", () => {
  it("reads the xStocks mint's permanent delegate and authorities", () => {
    expect(xstock.tokenProgram).toBe("token-2022");
    expect(xstock.permanentDelegate).toBe("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
    expect(xstock.freezeAuthority).toBe("JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs");
    expect(xstock.pausable).toEqual({ authority: "JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs", paused: false });
    expect(xstock.scaledUiAmount?.authority).toBe("S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS");
    expect(xstock.transferHook).toEqual({ authority: "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq", programId: null });
    expect(xstock.defaultAccountState).toBe("initialized");
  });

  it("reads the Ondo mint, which has no permanent delegate", () => {
    expect(ondo.tokenProgram).toBe("token-2022");
    expect(ondo.permanentDelegate).toBeNull();
    expect(ondo.freezeAuthority).toBe("51QVCuHfL1FeNjd8BDeffCKhCcAYoULnVB3yjNhShiuK");
    expect(ondo.pausable?.paused).toBe(false);
  });
});

describe("assess", () => {
  it("grades a mint with a permanent delegate as custodial", () => {
    const a = assess(xstock);
    expect(a.level).toBe("custodial");
    expect(a.custodial.some((s) => s.includes("permanentDelegate"))).toBe(true);
    expect(a.haltable.some((s) => s.includes("freezeAuthority"))).toBe(true);
    expect(a.haltable.some((s) => s.includes("pauseAuthority"))).toBe(true);
  });

  it("grades a mint without a delegate but with a freeze/pause authority as haltable", () => {
    const a = assess(ondo);
    expect(a.level).toBe("haltable");
    expect(a.custodial).toEqual([]);
  });

  it("grades a bare mint as benign", () => {
    const bare: IssuerPowers = {
      mint: "x",
      tokenProgram: "spl-token",
      decimals: 6,
      mintAuthority: null,
      freezeAuthority: null,
      permanentDelegate: null,
      pausable: null,
      defaultAccountState: null,
      closeAuthority: null,
      scaledUiAmount: null,
      confidentialTransfer: null,
      transferHook: null,
      transferFee: null,
      interestBearing: null,
      permissionedBurn: null,
      extensions: [],
      extensionAuthorities: {},
    };
    expect(assess(bare).level).toBe("benign");
  });

  it("grades a mint-authority-only mint as mutable, not benign", () => {
    const a = assess({ ...xstock, permanentDelegate: null, freezeAuthority: null, pausable: null, defaultAccountState: null, scaledUiAmount: null, transferHook: null, confidentialTransfer: null, closeAuthority: null, mintAuthority: "Mint1111111111111111111111111111111111111111" });
    expect(a.level).toBe("mutable");
    expect(a.mutable.some((s) => s.includes("mintAuthority"))).toBe(true);
  });

  it("reads and grades a transfer-fee config", () => {
    const withFee = parseIssuerPowers({
      data: {
        program: "spl-token-2022",
        parsed: {
          type: "mint",
          info: {
            decimals: 6,
            extensions: [{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: "Cfg11111111111111111111111111111111111111111", withdrawWithheldAuthority: "Wd111111111111111111111111111111111111111111" } }],
          },
        },
      },
    });
    expect(withFee.transferFee).toEqual({ configAuthority: "Cfg11111111111111111111111111111111111111111", withdrawAuthority: "Wd111111111111111111111111111111111111111111" });
    expect(assess(withFee).mutable.some((s) => s.includes("transferFee"))).toBe(true);
  });
});

describe("diffPowers", () => {
  it("is empty for identical profiles", () => {
    expect(diffPowers(xstock, parseIssuerPowers(fx[NVDAX]))).toEqual([]);
  });

  it("ignores a multiplier update — operational churn, not a posture change", () => {
    const moved = withExtState(NVDAX, "scaledUiAmountConfig", { multiplier: "9.99", newMultiplier: "9.99", newMultiplierEffectiveTimestamp: 1 });
    expect(diffPowers(xstock, moved)).toEqual([]);
  });

  it("ignores a pause flip — operational, checked separately by consumers", () => {
    const paused = withExtState(NVDAX, "pausableConfig", { paused: true });
    expect(diffPowers(xstock, paused)).toEqual([]);
  });

  it("flags a rotated scaled-UI authority (generic sweep)", () => {
    const reauth = withExtState(NVDAX, "scaledUiAmountConfig", { authority: "rotate1111111111111111111111111111111111111" });
    const d = diffPowers(xstock, reauth);
    expect(d.length).toBe(1);
    expect(d[0]).toContain("scaledUiAmountConfig.authority");
  });

  it("flags a rotated mint authority", () => {
    const d = diffPowers(xstock, withInfo(NVDAX, { mintAuthority: "rotate1111111111111111111111111111111111111" }));
    expect(d.length).toBe(1);
    expect(d[0]).toContain("mintAuthority");
  });

  it("flags a transfer-hook program being set", () => {
    const d = diffPowers(xstock, withExtState(NVDAX, "transferHook", { programId: "Hook111111111111111111111111111111111111111" }));
    expect(d.some((s) => s.includes("transferHookProgramId"))).toBe(true);
  });

  it("flags a rotated authority nested inside an unmodelled extension", () => {
    const base = clone(fx[NVDAX]) as { data: { parsed: { info: { extensions: unknown[] } } } };
    const mk = (auth: string) => {
      const a = clone(base);
      a.data.parsed.info.extensions.push({ extension: "futureExtension", state: { config: { authority: auth } } });
      return parseIssuerPowers(a);
    };
    const d = diffPowers(mk("Aaaa111111111111111111111111111111111111111"), mk("Bbbb111111111111111111111111111111111111111"));
    expect(d.length).toBe(1);
    expect(d[0]).toContain("futureExtension.config.authority");
  });

  it("flags a permanent delegate being added to a mint that had none", () => {
    const a = clone(fx[NVDAON]) as { data: { parsed: { info: { extensions: { extension: string; state: Record<string, unknown> }[] } } } };
    a.data.parsed.info.extensions.push({ extension: "permanentDelegate", state: { delegate: "Deleg11111111111111111111111111111111111111" } });
    const d = diffPowers(ondo, parseIssuerPowers(a));
    // Both the extension set and the generic authority sweep change.
    expect(d.some((s) => s.includes("extensions"))).toBe(true);
    expect(d.some((s) => s.includes("permanentDelegate.delegate"))).toBe(true);
    // Each change on its own line, naming the power rather than dumping the whole authority map.
    expect(d).toEqual([
      'authorities.permanentDelegate.delegate: expected null, got "Deleg11111111111111111111111111111111111111"',
      "extensions: +permanentDelegate",
    ]);
  });
});

describe("gating", () => {
  type Mut = { data: { parsed: { info: { freezeAuthority?: string | null; extensions: { extension: string; state?: Record<string, unknown> }[] } } } };
  const mutate = (mint: string, f: (a: Mut) => void): IssuerPowers => {
    const a = clone(fx[mint]) as Mut;
    f(a);
    return parseIssuerPowers(a);
  };
  const drop = (a: Mut, ext: string) => (a.data.parsed.info.extensions = a.data.parsed.info.extensions.filter((e) => e.extension !== ext));

  it("classifies both live fixtures as latent, naming the hook and the default-state flip", () => {
    for (const p of [xstock, ondo]) {
      const g = gating(p);
      expect(g.model).toBe("latent");
      expect(g.reasons.some((r) => r.startsWith("transferHook authority="))).toBe(true);
      expect(g.reasons.some((r) => r.includes("can flip defaultAccountState"))).toBe(true);
    }
  });

  it("is per-transfer once a hook program is set", () => {
    const p = withExtState(NVDAX, "transferHook", { programId: "HookProgram111111111111111111111111111111111" });
    expect(gating(p).model).toBe("per-transfer");
  });

  it("is per-holder when new accounts start frozen", () => {
    const p = withExtState(NVDAX, "defaultAccountState", { accountState: "frozen" });
    expect(gating(p).model).toBe("per-holder");
  });

  it("lists every gate: a hook program and default-frozen together", () => {
    const p = mutate(NVDAX, (a) => {
      for (const e of a.data.parsed.info.extensions) {
        if (e.extension === "transferHook") e.state!.programId = "HookProgram111111111111111111111111111111111";
        if (e.extension === "defaultAccountState") e.state!.accountState = "frozen";
      }
    });
    const g = gating(p);
    expect(g.model).toBe("per-transfer");
    expect(g.reasons.some((r) => r.startsWith("defaultAccountState=frozen"))).toBe(true);
  });

  it("says when a default-frozen mint has no freeze authority to thaw anyone", () => {
    const p = mutate(NVDAX, (a) => {
      a.data.parsed.info.freezeAuthority = null;
      for (const e of a.data.parsed.info.extensions) if (e.extension === "defaultAccountState") e.state!.accountState = "frozen";
    });
    expect(gating(p).reasons.some((r) => r.includes("no freeze authority"))).toBe(true);
  });

  it("is boundary with no hook and no default state, even with freeze and a delegate", () => {
    const p = mutate(NVDAX, (a) => {
      drop(a, "transferHook");
      drop(a, "defaultAccountState");
    });
    expect(gating(p)).toEqual({ model: "boundary", reasons: [] });
    expect(assess(p).level).toBe("custodial");
  });

  it("is boundary when the hook has neither authority nor program and no freeze authority can flip state", () => {
    const p = mutate(NVDAX, (a) => {
      a.data.parsed.info.freezeAuthority = null;
      for (const e of a.data.parsed.info.extensions) if (e.extension === "transferHook") e.state = { authority: null, programId: null };
    });
    expect(gating(p).model).toBe("boundary");
  });

  it("is boundary for a legacy spl-token mint (USDC shape)", () => {
    const usdc = {
      data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar", mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", isInitialized: true, supply: "1" } } },
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    };
    expect(gating(parseIssuerPowers(usdc))).toEqual({ model: "boundary", reasons: [] });
  });

  it("is non-transferable when the mint carries NonTransferable, even with a hook program", () => {
    const p = mutate(NVDAX, (a) => {
      a.data.parsed.info.extensions.push({ extension: "nonTransferable" });
      for (const e of a.data.parsed.info.extensions) if (e.extension === "transferHook") e.state!.programId = "HookProgram111111111111111111111111111111111";
    });
    expect(gating(p).model).toBe("non-transferable");
  });

  it("is unknown when an extension could not be parsed", () => {
    const p = mutate(NVDAX, (a) => {
      drop(a, "transferHook");
      drop(a, "defaultAccountState");
      a.data.parsed.info.extensions.push({ extension: "unparseableExtension" });
    });
    expect(gating(p).model).toBe("unknown");
  });

  it("is unknown for an unknown token program, but a certain gate still wins over unreadable", () => {
    const a = clone(fx[NVDAX]) as { data: { program: string; parsed: { info: { extensions: { extension: string }[] } } }; owner: string };
    a.data.program = "something-else";
    a.owner = "Unknown111111111111111111111111111111111111";
    expect(gating(parseIssuerPowers(a)).model).toBe("unknown");
    a.data.parsed.info.extensions.push({ extension: "nonTransferable" });
    expect(gating(parseIssuerPowers(a)).model).toBe("non-transferable");
  });
});

describe("parseIssuerPowers robustness", () => {
  it("rejects a token account rather than grading it benign", () => {
    const tokenAccount = { data: { program: "spl-token-2022", parsed: { type: "account", info: { mint: "x", owner: "y", extensions: [] } } } };
    expect(() => parseIssuerPowers(tokenAccount)).toThrow(/not a mint/);
  });

  it("rejects a base64 (non-jsonParsed) account", () => {
    expect(() => parseIssuerPowers({ data: ["AQID", "base64"], owner: "Tokenz" })).toThrow();
  });

  it("rejects a parsed envelope that does not say type mint", () => {
    // type missing entirely, with a mint-shaped info — must still be refused.
    expect(() => parseIssuerPowers({ data: { program: "spl-token-2022", parsed: { info: { decimals: 6, extensions: [] } } } })).toThrow(/not a mint/);
  });
});

describe("readIssuerPowers", () => {
  it("fetches jsonParsed and parses it", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: fx[NVDAX] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const p = await readIssuerPowers(NVDAX, "http://unused", fakeFetch);
    expect(p.permanentDelegate).toBe("5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq");
  });
});
