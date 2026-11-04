import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assess, diffPowers, parseIssuerPowers, readIssuerPowers, type IssuerPowers } from "../src/index.js";

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
