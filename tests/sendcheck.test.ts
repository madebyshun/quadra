import { describe, expect, it } from "vitest";
import { encodeFunctionResult, parseAbi } from "viem";
import { USDC } from "@/config/chain";
import { toChecksumAddress } from "@/lib/address";
import { parseTransfers } from "@/skills/profile";
import { decisionRow, historyOf, historyRow, kindRow, looksAlike, nameRow, sendCheck, sendCheckSkill } from "@/skills/sendcheck";
import { row } from "@/skills/types";
import { ADDR } from "./fixtures/base";
import { OWNER, PX } from "./fixtures/profile";
import { basenames, DOWN, ethCalls, net, useNet, type Answer } from "./net";

useNet();

/**
 * Send Check against the owner's REAL wallet history — an address-poisoning campaign, MEASURED
 * 2026-10-02 — and the look-alike it planted: 0x00FDCd…746F, against the owner's deployer.
 */

const DEPLOYER = "0x00FD29B7D6dbf13afb879AfBb239dB1D48Ce746F";
/** The look-alike the campaign planted in the owner's history, read from the capture. */
const PLANTED = toChecksumAddress(PX.transfersOwner.items.find((i) => i.token.symbol === "ETH" && i.from.hash === OWNER)!.to.hash);
/** Relay's receiver the owner really paid (the test2 buy), read from the capture. */
const REAL = toChecksumAddress(PX.transfersOwner.items.find((i) => i.token.symbol === "USDC")!.to.hash);
const moved = parseTransfers(PX.transfersOwner);
const TRANSFERS = `https://base.blockscout.com/api/v2/addresses/${OWNER}/token-transfers?type=ERC-20`;
const names = ethCalls(basenames({ resolver: ADDR.l2Resolver, forward: { "pay.base.eth": REAL } }));
const ERC20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"]);
/** USDC's getters, as config states them (symbol and decimals are verified there; the supply is a stand-in). */
const USDC_READS: Record<string, `0x${string}`> = {
  "0x06fdde03": encodeFunctionResult({ abi: ERC20, functionName: "name", result: "USD Coin" }),
  "0x95d89b41": encodeFunctionResult({ abi: ERC20, functionName: "symbol", result: USDC.symbol }),
  "0x313ce567": encodeFunctionResult({ abi: ERC20, functionName: "decimals", result: USDC.decimals }),
  "0x18160ddd": encodeFunctionResult({ abi: ERC20, functionName: "totalSupply", result: 1n }),
};

function chain(over: { code?: Record<string, string>; codeDown?: boolean; namesDown?: boolean; transfers?: Answer } = {}) {
  net({
    get: (u) => (u === TRANSFERS ? (over.transfers ?? PX.transfersOwner) : undefined),
    rpc: (m, p) => {
      const call = p[0] as { to?: string; data?: string } | string;
      if (m === "eth_getCode") return over.codeDown ? DOWN : (over.code?.[String(call).toLowerCase()] ?? "0x");
      if (m === "eth_call" && typeof call !== "string" && call.to?.toLowerCase() === USDC.address.toLowerCase()) return USDC_READS[call.data!] ?? DOWN;
      if (m === "eth_call" && typeof call !== "string" && call.to?.toLowerCase() === "0x1111111111111111111111111111111111111111") return DOWN;
      if (over.namesDown && m === "eth_call") return DOWN;
      return names(m, p);
    },
  });
}

describe("look-alikes and planted addresses", () => {
  it("calls two addresses with the same first and last four characters a look-alike — the pair MEASURED in the owner's history", () => {
    expect(looksAlike(PLANTED, DEPLOYER)).toBe(true);
    expect(looksAlike(DEPLOYER, DEPLOYER.toLowerCase())).toBe(false);
    expect(looksAlike(OWNER, DEPLOYER)).toBe(false);
  });

  it("splits the owner's counterparties into the real ones and the ones a fake transfer planted", () => {
    const h = historyOf(OWNER, moved);
    expect(h.planted.has(PLANTED.toLowerCase())).toBe(true);
    expect(h.real.has(REAL.toLowerCase())).toBe(true);
    expect(h.real.has(PLANTED.toLowerCase())).toBe(false);
    // a transfer to yourself names no counterparty
    expect(historyOf(OWNER, [{ ...moved[0]!, from: OWNER, to: OWNER }])).toEqual({ real: new Set(), planted: new Set() });
  });

  it("says what the history means for a recipient: planted, a look-alike, known, or new", () => {
    const h = historyOf(OWNER, moved);
    expect(historyRow(PLANTED, h)).toMatchObject({ tone: "bad", value: expect.stringContaining("PLANTED") });
    const twin = `${REAL.slice(0, 6)}${"7".repeat(32)}${REAL.slice(-4)}`;
    expect(historyRow(twin, h)).toMatchObject({ tone: "bad", value: expect.stringContaining(`a LOOK-ALIKE of ${REAL}`), href: `https://basescan.org/address/${REAL}` });
    expect(historyRow(REAL, h)).toMatchObject({ tone: "ok" });
    expect(historyRow(ADDR.degen, h).tone).toBeUndefined();
  });

  it("names what is at an address, its Basename, and the decision", () => {
    expect(kindRow({ kind: "wallet" }, null).tone).toBe("ok");
    expect(kindRow({ kind: "delegated", to: DEPLOYER }, null).value).toContain("EIP-7702 delegation to 0x00FD…746F");
    expect(kindRow({ kind: "contract" }, { symbol: "USDC" })).toMatchObject({ tone: "bad", value: expect.stringContaining("the USDC TOKEN contract") });
    expect(kindRow({ kind: "contract" }, null).tone).toBe("warn");
    expect(nameRow({ kind: "none" })).toEqual(row("Basename", "none"));
    expect(nameRow({ kind: "verified", name: "pay.base.eth" }).tone).toBe("ok");
    expect(nameRow({ kind: "unverified", name: "x.base.eth", pointsTo: null })).toMatchObject({ tone: "bad", value: "x.base.eth claims this address but points to nothing — a false claim" });
    expect(decisionRow([row("a", "b", { tone: "warn" })])).toMatchObject({ value: "Check before sending — see the amber lines" });
    expect(decisionRow([row("a", "b", { tone: "ok" })])).toMatchObject({ value: "No red flags found" });
  });
});

describe("the check", () => {
  it("stops at the planted look-alike, given the sender's address", async () => {
    chain();
    const r = await sendCheck(PLANTED, OWNER);
    expect(r.rows[0]).toMatchObject({ label: "Decision", tone: "bad", value: "Do not send — see the red lines" });
    expect(r.rows.find((x) => x.label === "Checksum")!.tone).toBe("ok");
    expect(r.rows.find((x) => x.label === "Your history")!.value).toContain("PLANTED");
    expect(r.sources).toContain("Blockscout (your token transfers)");
  });

  it("refuses a contradicted checksum before reading anything", async () => {
    net({});
    const typo = OWNER.replace("D5C1", "d5C1");
    const r = await sendCheck(typo);
    expect(r.rows).toEqual([row("Decision", "Do not send — see the red lines", { tone: "bad" }), row("Checksum", expect.stringContaining("contradicts"), { tone: "bad" })]);
  });

  it("asks for a careful look at an all-lowercase address, and names a Basename it came from", async () => {
    chain();
    const r = await sendCheck(REAL.toLowerCase(), "");
    expect(r.rows.find((x) => x.label === "Checksum")).toMatchObject({ tone: "warn" });
    expect(r.notes.join(" ")).toContain("Give your own address too");
    chain();
    const named = await sendCheck("pay");
    expect(named.rows.find((x) => x.label === "Name")!.value).toBe("pay.base.eth resolves to this address");
    expect(named.title).toBe(`Send Check — ${REAL}`);
    expect(named.rows.find((x) => x.label === "Checksum")).toBeUndefined();
  });

  it("stops at a token's own contract, and is careful with any other contract", async () => {
    chain({ code: { [USDC.address.toLowerCase()]: "0x6080604052", "0x1111111111111111111111111111111111111111": "0x6080604052" } });
    expect((await sendCheck(USDC.address)).rows.find((x) => x.label === "What is there")!.value).toContain("the USDC TOKEN contract");
    expect((await sendCheck("0x1111111111111111111111111111111111111111")).rows.find((x) => x.label === "What is there")!.tone).toBe("warn");
  });

  it("says what it could not read, and that sending to yourself is odd", async () => {
    chain({ codeDown: true, namesDown: true, transfers: DOWN });
    const r = await sendCheck(REAL, OWNER);
    expect(r.rows.filter((x) => x.value.startsWith("not checked")).map((x) => x.label)).toEqual(["What is there", "Basename", "Your history"]);
    chain();
    expect((await sendCheck(OWNER, OWNER)).rows.find((x) => x.label === "Your history")).toMatchObject({ tone: "warn", value: "this is your own address" });
    chain();
    expect((await sendCheckSkill.run([REAL])).title).toBe(`Send Check — ${REAL}`);
  });
});
