import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, getAddress } from "viem";
import { BASE, USDC } from "@/config/chain";
import { BALANCE_TRIES, ethReceived, parseReceipt, sendTransaction, SIMULATE_TRIES, simulate, tokenReceived, TRANSFER_TOPIC, waitForReceipt, type Receipt } from "@/lib/transact";
import { accountKind, allowance, approveData, balanceOf, ETH, kindOfCode, readToken, transferData } from "@/lib/erc20";
import type { Eip1193Provider, Eip1193Request } from "@/lib/wallet";
import { contractAt, DOWN, ethCalls, net, RpcError, useNet } from "./net";
import { ROUTES_FX, SWAPPER, USDC_ETH } from "./fixtures/routes";

useNet();

const FROM = "0x2211d1D0020DAEA8039E46Cf1367962070d77DA9";
const TO = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;

/** A wallet on Base, connected as `account`, that answers eth_sendTransaction with `send`. */
function wallet(account: string | null, send: (params: unknown) => unknown = () => HASH): Eip1193Provider & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    request(args: Eip1193Request) {
      if (args.method === "eth_accounts") return Promise.resolve(account ? [account] : []);
      if (args.method === "eth_chainId") return Promise.resolve(BASE.idHex);
      if (args.method === "eth_sendTransaction") {
        sent.push(args.params?.[0]);
        try {
          return Promise.resolve(send(args.params?.[0]));
        } catch (e) {
          return Promise.reject(e);
        }
      }
      return Promise.reject(new Error(`unstubbed ${args.method}`));
    },
  };
}

describe("sendTransaction", () => {
  it("asks the wallet to send, from the account on screen, and returns the hash", async () => {
    const w = wallet(FROM.toLowerCase());
    expect(await sendTransaction(w, FROM, { to: TO, value: 10n ** 15n })).toBe(HASH);
    expect(w.sent).toEqual([{ from: FROM.toLowerCase(), to: TO, value: "0x38d7ea4c68000" }]);
  });

  it("includes calldata only when there is some, and sends zero value by default", async () => {
    const w = wallet(FROM);
    await sendTransaction(w, FROM, { to: TO, data: "0xa9059cbb" });
    expect(w.sent[0]).toEqual({ from: FROM.toLowerCase(), to: TO, value: "0x0", data: "0xa9059cbb" });
  });

  /** Reviewed for A, must never go out from B. */
  it("refuses when the wallet has switched accounts since the review", async () => {
    const w = wallet(TO);
    await expect(sendTransaction(w, FROM, { to: TO })).rejects.toThrow(/Your wallet is now on account .* Nothing was sent/);
    expect(w.sent).toEqual([]);
  });

  it("refuses when the wallet is no longer connected, saying why", async () => {
    await expect(sendTransaction(wallet(null), FROM, { to: TO })).rejects.toThrow(/No account is connected yet\..* Nothing was sent\.$/);
  });

  it("says a rejection is the user's choice, whether the code is a number or a string", async () => {
    for (const code of [4001, "4001"]) {
      const w = wallet(FROM, () => {
        throw Object.assign(new Error("User rejected"), { code });
      });
      await expect(sendTransaction(w, FROM, { to: TO })).rejects.toThrow("You rejected it in your wallet. Nothing was sent.");
    }
  });

  it("passes on any other refusal with the wallet's own words, when it has some", async () => {
    const insufficient = wallet(FROM, () => {
      throw Object.assign(new Error("insufficient funds for gas"), { code: -32000 });
    });
    await expect(sendTransaction(insufficient, FROM, { to: TO })).rejects.toThrow("Your wallet did not send it (insufficient funds for gas).");
    const silent = wallet(FROM, () => {
      throw "nope";
    });
    await expect(sendTransaction(silent, FROM, { to: TO })).rejects.toThrow("Your wallet did not send it.");
    const blank = wallet(FROM, () => {
      throw new Error("");
    });
    await expect(sendTransaction(blank, FROM, { to: TO })).rejects.toThrow("Your wallet did not send it.");
  });

  /** It may have sent — saying "failed" here would invite a second payment. */
  it("does not call a non-hash answer a failure", async () => {
    await expect(sendTransaction(wallet(FROM, () => ({ ok: true })), FROM, { to: TO })).rejects.toThrow(
      /instead of a transaction hash\. Check the wallet's activity before trying again — it may have sent\./,
    );
  });

  it("never asks the wallet to do anything but send what the user sees", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/transact.ts"), "utf8");
    for (const forbidden of ["eth_sign", "personal_sign", "eth_sendRawTransaction", "privateKey", "mnemonic", "wallet_addEthereumChain"]) {
      expect(source, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});

/**
 * docs.base.org simulates every write before it sends it. So does this app: a transaction the
 * chain already refuses — a paused B20 stock, a policy that blocks the buyer — stops before the
 * wallet asks for a signature and a gas fee.
 */
describe("simulating before sending", () => {
  it("runs the transaction as a call from the user first, and sends when the chain would take it", async () => {
    const asked: unknown[] = [];
    net({ rpc: (m, p) => (m === "eth_call" ? (asked.push(p), "0x") : undefined) });
    const w = wallet(FROM);
    await sendTransaction(w, FROM, { to: TO, data: "0xa9059cbb", value: 5n });
    // from the account the wallet reports, as it reports it
    expect(asked).toEqual([[{ from: FROM.toLowerCase(), to: TO, value: "0x5", data: "0xa9059cbb" }, "latest"]]);
    expect(w.sent).toHaveLength(1);
    asked.length = 0;
    expect(await simulate(FROM, { to: TO })).toBeNull();
    expect(asked).toEqual([[{ from: FROM, to: TO, value: "0x0" }, "latest"]]);
  });

  it("stops what the chain refuses, in the chain's own words, before the wallet is asked", async () => {
    let tries = 0;
    net({ rpc: (m) => (m === "eth_call" ? (tries++, new RpcError("execution reverted: ContractPaused(0)")) : undefined) });
    const w = wallet(FROM);
    const naps: number[] = [];
    await expect(sendTransaction(w, FROM, { to: TO, data: "0xa9059cbb" }, { every: 3, sleep: async (ms) => void naps.push(ms) })).rejects.toThrow(
      'Base would refuse this right now — tried without sending, the chain answered "execution reverted: ContractPaused(0)". Nothing was sent.',
    );
    expect(w.sent).toEqual([]);
    expect(tries).toBe(SIMULATE_TRIES);
    expect(naps).toEqual([3, 3]);
  });

  /** The node answering may be a block behind the approval that just confirmed. */
  it("asks again before it believes a revert", async () => {
    let lag = 2;
    net({ rpc: (m) => (m === "eth_call" ? (lag-- > 0 ? new RpcError("execution reverted: InsufficientAllowance") : "0x") : undefined) });
    const w = wallet(FROM);
    await sendTransaction(w, FROM, { to: TO }, { sleep: async () => {} });
    expect(w.sent).toHaveLength(1);
  });

  it("does not read a node that cannot answer as a refusal — the wallet checks the transaction too", async () => {
    net({ rpc: (m) => (m === "eth_call" ? DOWN : undefined) });
    const w = wallet(FROM);
    await sendTransaction(w, FROM, { to: TO });
    expect(w.sent).toHaveLength(1);
  });
});

describe("what a swap delivered", () => {
  const ethUsdc = () => parseReceipt(ROUTES_FX.receiptEthUsdc)!;

  /** MEASURED: a real Relay swap of ~0.592 ETH delivered 1616.193741 USDC to its sender. */
  it("reads a token's arrival from the receipt's own Transfer events", () => {
    expect(tokenReceived(ethUsdc(), USDC.address, SWAPPER)).toBe(1_616_193_741n);
    // case does not matter on either address
    expect(tokenReceived(ethUsdc(), USDC.address.toLowerCase(), SWAPPER.toUpperCase().replace("0X", "0x"))).toBe(1_616_193_741n);
  });

  it("counts only transfers OF that token TO that account", () => {
    // the same receipt moved USDC between the pools and the router — none of that is the user's
    expect(tokenReceived(ethUsdc(), USDC.address, TO)).toBe(0n);
    expect(tokenReceived(ethUsdc(), TO, SWAPPER)).toBe(0n);
  });

  it("adds up several deliveries, and skips a log it cannot read", () => {
    const r = ethUsdc();
    const delivery = r.logs.find((l) => l.topics[0] === TRANSFER_TOPIC && l.topics[2]!.endsWith(SWAPPER.slice(2)))!;
    const twice: Receipt = { ...r, logs: [...r.logs, delivery, { ...delivery, data: "not hex" }, { ...delivery, topics: [delivery.topics[0]!] }, { ...delivery, topics: [] }] };
    expect(tokenReceived(twice, USDC.address, SWAPPER)).toBe(2n * 1_616_193_741n);
  });

  /**
   * MEASURED: a real USDC → ETH swap. The ETH arrives through a WETH withdrawal and no log names
   * the sender, so it is read from balances at the receipt's block — and the answer matches the
   * WETH withdrawn in the same receipt to the wei.
   */
  it("reads ETH's arrival from the balance at the receipt's block and the one before, plus the fee", async () => {
    const asked: unknown[] = [];
    net({
      rpc: (m, p) => {
        if (m !== "eth_getBalance") return undefined;
        asked.push(p);
        return p[1] === USDC_ETH.block ? `0x${USDC_ETH.after.toString(16)}` : p[1] === USDC_ETH.previous ? `0x${USDC_ETH.before.toString(16)}` : undefined;
      },
    });
    const r = parseReceipt(ROUTES_FX.receiptUsdcEth)!;
    expect(await ethReceived(r, SWAPPER)).toBe(USDC_ETH.received);
    expect(asked).toEqual([
      [SWAPPER, USDC_ETH.block],
      [SWAPPER, USDC_ETH.previous],
    ]);
    const withdrawn = r.logs.find((l) => l.topics[0] === "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65")!;
    expect(BigInt(withdrawn.data)).toBe(USDC_ETH.received);
  });

  it("says it could not measure when the fee is unknown — without reading anything", async () => {
    const calls = net({});
    const r = { ...parseReceipt(ROUTES_FX.receiptUsdcEth)!, fee: null };
    expect(await ethReceived(r, SWAPPER)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("asks a lagging node again, and gives up as unmeasured — never as an error", async () => {
    const r = parseReceipt(ROUTES_FX.receiptUsdcEth)!;
    let lag = 2;
    const naps: number[] = [];
    net({ rpc: (m, p) => (m !== "eth_getBalance" ? undefined : p[1] === USDC_ETH.block && lag-- > 0 ? new RpcError("header not found") : `0x${(p[1] === USDC_ETH.block ? USDC_ETH.after : USDC_ETH.before).toString(16)}`) });
    expect(await ethReceived(r, SWAPPER, { every: 7, sleep: async (ms) => void naps.push(ms) })).toBe(USDC_ETH.received);
    expect(naps).toEqual([7, 7]);

    naps.length = 0;
    net({ rpc: (m) => (m === "eth_getBalance" ? new RpcError("header not found") : undefined) });
    expect(await ethReceived(r, SWAPPER, { every: 1, sleep: async (ms) => void naps.push(ms) })).toBeNull();
    expect(naps).toHaveLength(BALANCE_TRIES - 1);

    net({ rpc: (m, p) => (m !== "eth_getBalance" ? undefined : p[1] === USDC_ETH.block ? `0x${USDC_ETH.after.toString(16)}` : new RpcError("pruned")) });
    expect(await ethReceived(r, SWAPPER, { sleep: async () => {} })).toBeNull();
  });

  it("waits a second between tries by default", async () => {
    vi.useFakeTimers();
    try {
      const r = parseReceipt(ROUTES_FX.receiptUsdcEth)!;
      let first = true;
      net({ rpc: (m, p) => (m !== "eth_getBalance" ? undefined : first ? ((first = false), new RpcError("lag")) : `0x${(p[1] === USDC_ETH.block ? USDC_ETH.after : USDC_ETH.before).toString(16)}`) });
      const got = ethReceived(r, SWAPPER);
      await vi.advanceTimersByTimeAsync(999);
      let done = false;
      void got.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await got).toBe(USDC_ETH.received);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("receipts", () => {
  it("reads success, reverted and the logs", () => {
    expect(
      parseReceipt({
        status: "0x1",
        blockNumber: "0x10",
        logs: [{ address: TO, topics: ["0xaa", 7], data: "0x" }, null, { address: TO }, "x"],
      }),
    ).toEqual({ status: "success", block: 16n, logs: [{ address: TO, topics: ["0xaa"], data: "0x" }], fee: null });
    expect(parseReceipt({ status: "0x0", blockNumber: "0x1" })).toEqual({ status: "reverted", block: 1n, logs: [], fee: null });
  });

  it("reads what the sender paid: L2 gas × price plus Base's L1 data fee", () => {
    const r = ROUTES_FX.receiptUsdcEth;
    const l2 = BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice);
    expect(parseReceipt(r)!.fee).toBe(l2 + BigInt(r.l1Fee));
    expect(parseReceipt({ ...r, l1Fee: undefined })!.fee).toBe(l2);
    expect(parseReceipt({ ...r, gasUsed: undefined })!.fee).toBeNull();
    expect(parseReceipt({ ...r, effectiveGasPrice: "lots" })!.fee).toBeNull();
  });

  it("pins the Transfer topic to the event's signature", async () => {
    const { keccak256 } = await import("@/lib/keccak");
    const hex = (b: Uint8Array) => `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    expect(hex(keccak256(new TextEncoder().encode("Transfer(address,address,uint256)")))).toBe(TRANSFER_TOPIC);
  });

  it("reads no receipt as still pending", () => {
    expect(parseReceipt(null)).toBeNull();
  });

  it("refuses a receipt with no readable block", () => {
    expect(() => parseReceipt({ status: "0x1" })).toThrow(/the receipt's block number/);
  });

  it("polls until the chain has one", async () => {
    let polls = 0;
    const naps: number[] = [];
    net({ rpc: (m) => (m === "eth_getTransactionReceipt" ? (++polls < 3 ? null : { status: "0x1", blockNumber: "0x2", logs: [] }) : undefined) });
    const receipt = await waitForReceipt(HASH, { every: 5, within: 100, sleep: async (ms) => void naps.push(ms) });
    expect(receipt?.status).toBe("success");
    expect(naps).toEqual([5, 5]);
  });

  it("gives up with null — still pending, not failed — when the wait runs out", async () => {
    net({ rpc: () => null });
    expect(await waitForReceipt(HASH, { every: 1, within: 2 })).toBeNull();
  });

  it("returns at once when the receipt is already there", async () => {
    net({ rpc: () => ({ status: "0x1", blockNumber: "0x3" }) });
    expect((await waitForReceipt(HASH))?.block).toBe(3n);
  });
});

describe("erc20", () => {
  const token = (answers: Record<string, unknown>) => net({ rpc: ethCalls({ [USDC.address]: contractAt(erc20Abi, answers) }) });

  it("reads a token's decimals and symbol from its own contract", async () => {
    token({ decimals: 6, symbol: "USDC" });
    expect(await readToken(USDC.address)).toEqual({ kind: "erc20", address: USDC.address, symbol: "USDC", decimals: 6 });
  });

  it("refuses an address that does not answer decimals()", async () => {
    net({ rpc: ethCalls({ [TO]: () => new RpcError("execution reverted") }) });
    await expect(readToken(TO)).rejects.toThrow(`${TO} does not answer decimals() like a token on Base. Check the address.`);
  });

  /** A few old tokens return bytes32 for symbol(); the address is the identity anyway. */
  it("shortens the address when symbol() cannot be read as text", async () => {
    net({
      rpc: ethCalls({
        [USDC.address]: (data) =>
          decodeFunctionData({ abi: erc20Abi, data }).functionName === "decimals"
            ? encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 18 })
            : `0x4d4b52${"0".repeat(58)}`,
      }),
    });
    expect((await readToken(USDC.address)).symbol).toBe("0x8335…");
  });

  it("reads balances of ETH and of a token, and an allowance", async () => {
    net({
      rpc: (m, p) =>
        m === "eth_getBalance" ? "0x64" : ethCalls({ [USDC.address]: contractAt(erc20Abi, { balanceOf: 7n, allowance: 3n }) })(m, p),
    });
    expect(await balanceOf(ETH, FROM)).toBe(100n);
    expect(await balanceOf({ kind: "erc20", address: USDC.address, symbol: "USDC", decimals: 6 }, FROM)).toBe(7n);
    expect(await allowance(USDC.address, FROM, TO)).toBe(3n);
  });

  it("encodes a transfer and an approval for exactly the amount", () => {
    expect(decodeFunctionData({ abi: erc20Abi, data: transferData(TO, 5n) })).toEqual({ functionName: "transfer", args: [TO, 5n] });
    expect(decodeFunctionData({ abi: erc20Abi, data: approveData(TO, 5n) })).toEqual({ functionName: "approve", args: [TO, 5n] });
  });

  it("tells a contract from a wallet", async () => {
    net({ rpc: (_m, p) => (p[0] === TO ? "0x6080" : "0x") });
    expect(await accountKind(TO)).toEqual({ kind: "contract" });
    expect(await accountKind(FROM)).toEqual({ kind: "wallet" });
  });

  /**
   * MEASURED 2026-09-30: the owner's fee address 0xD5C1…3FAB answers this exact code on Base and
   * on Robinhood Chain — an EIP-7702 delegation to MetaMask's EIP7702StatelessDeleGator. Still a
   * wallet one key controls, and it must not be mistaken for a contract.
   */
  it("reads an EIP-7702 delegation as a wallet with a delegate, not as a contract", () => {
    expect(kindOfCode("0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b")).toEqual({
      kind: "delegated",
      // checksummed by viem, an implementation independent of lib/address.ts
      to: getAddress("0x63c0c19a282a1b52b07dd5a65b58948a07dae32b"),
    });
    // one byte more or less is not a delegation designator
    expect(kindOfCode("0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b00")).toEqual({ kind: "contract" });
    expect(kindOfCode("0xef0100")).toEqual({ kind: "contract" });
  });
});
