import { describe, expect, it } from "vitest";
import { BACKSTOP_ABI, readBackstop } from "@/lib/backstop";
import { contractAt, ethCalls, net, useNet } from "./net";

useNet();

/** Reading Stage C's Backstop (contracts/src/Backstop.sol): its bid, its burns, its last poke and its ETH. */
const AT = "0xc5b6CA155E17a4Ff45ffC056Ff39468d48940409";

describe("reading the backstop", () => {
  it("reads whether a bid is placed, what it burnt, when it was poked and the ETH waiting", async () => {
    const calls = ethCalls({ [AT]: contractAt(BACKSTOP_ABI, { liquidity: 1_439_400n, burned: 5n, lastPoke: 1_764_000_000n }) });
    net({ rpc: (m, p) => (m === "eth_getBalance" ? "0x2386f26fc10000" : calls(m, p)) });
    expect(await readBackstop(AT)).toEqual({ address: AT, placed: true, waiting: 10n ** 16n, burned: 5n, lastPoke: 1_764_000_000 });
  });

  it("says no bid when its liquidity is zero", async () => {
    const calls = ethCalls({ [AT]: contractAt(BACKSTOP_ABI, { liquidity: 0n, burned: 0n, lastPoke: 0n }) });
    net({ rpc: (m, p) => (m === "eth_getBalance" ? "0x0" : calls(m, p)) });
    expect((await readBackstop(AT)).placed).toBe(false);
  });
});
