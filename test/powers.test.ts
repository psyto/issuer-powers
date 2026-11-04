import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assess, diffPowers, parseIssuerPowers, readIssuerPowers, type IssuerPowers } from "../src/index.js";

const fx = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/mints.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const NVDAON = "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo"; // Ondo
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"; // xStocks

const ondo = parseIssuerPowers(fx[NVDAON]);
const xstock = parseIssuerPowers(fx[NVDAX]);

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
      extensions: [],
    };
    expect(assess(bare).level).toBe("benign");
  });
});

describe("diffPowers", () => {
  it("is empty for identical profiles", () => {
    expect(diffPowers(xstock, parseIssuerPowers(fx[NVDAX]))).toEqual([]);
  });

  it("flags a silently added permanent delegate", () => {
    const tampered = { ...ondo, permanentDelegate: "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq" };
    const d = diffPowers(ondo, tampered);
    expect(d.length).toBe(1);
    expect(d[0]).toContain("permanentDelegate");
  });

  it("ignores a multiplier update — operational churn, not a posture change", () => {
    const moved = { ...xstock, scaledUiAmount: { ...xstock.scaledUiAmount!, multiplier: "9.99", newMultiplier: "9.99", newMultiplierEffectiveTimestamp: 1 } };
    expect(diffPowers(xstock, moved)).toEqual([]);
  });

  it("flags a changed scaled-UI authority", () => {
    const reauth = { ...xstock, scaledUiAmount: { ...xstock.scaledUiAmount!, authority: "someoneElse111111111111111111111111111111111" } };
    expect(diffPowers(xstock, reauth).length).toBe(1);
  });

  it("flags a mint-authority rotation", () => {
    expect(diffPowers(xstock, { ...xstock, mintAuthority: "rotated1111111111111111111111111111111111111" }).length).toBe(1);
  });

  it("is order-insensitive on the extensions list", () => {
    expect(diffPowers(xstock, { ...xstock, extensions: [...xstock.extensions].reverse() })).toEqual([]);
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
