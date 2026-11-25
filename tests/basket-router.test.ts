import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { USDC } from "@/config/chain";
import { USDC_DOMAIN } from "@/lib/eip712";
import { buyData, buyWithPermitData, deadlineFrom, permitTypedData, ROUTER_ABI, ROUTER_DEADLINE_SECONDS, routerLeg, signPermit, totalOf, type RouterLeg } from "@/lib/basketRouter";
import { USER } from "./fixtures/routes";
import { net, useNet } from "./net";

/** The browser half of BasketRouter: the calls it encodes, the permit it asks for, and its refusals. */
useNet();

const ROUTER = "0x00000000000000000000000000000000ba5ce701";
const leg = (amountIn: bigint): RouterLeg => ({ target: "0x5567954cD026CEbFE486062cb75848e0f1c12E58", amountIn, tokenOut: "0xb20000000000000000000078ee7ce2fE4908108C", minOut: 5n, data: "0x1234" });

describe("BasketRouter calls", () => {
  it("adds up the legs, gives five minutes, and encodes buy and buyWithPermit with the signature's parts", () => {
    expect(totalOf([leg(6n), leg(4n)])).toBe(10n);
    expect(deadlineFrom(1_800_000_000_500)).toBe(BigInt(1_800_000_000 + ROUTER_DEADLINE_SECONDS));
    const plain = decodeFunctionData({ abi: ROUTER_ABI, data: buyData([leg(6n)], 99n) });
    expect(plain.functionName).toBe("buy");
    expect(plain.args).toEqual([[leg(6n)], 99n]);
    const r = `0x${"11".repeat(32)}`;
    const s = `0x${"22".repeat(32)}`;
    for (const [tail, v] of [["1b", 27], ["1c", 28], ["00", 27], ["01", 28]] as const) {
      const call = decodeFunctionData({ abi: ROUTER_ABI, data: buyWithPermitData([leg(6n)], 99n, `${r}${s.slice(2)}${tail}` as `0x${string}`) });
      expect(call.functionName).toBe("buyWithPermit");
      expect(call.args.slice(2)).toEqual([v, r, s]);
    }
  });

  it("asks for a Permit in USDC's own domain, for exactly the value, to the router", () => {
    const t = permitTypedData(USER, ROUTER, 10_000_000n, 3n, 99n);
    expect(t.domain).toEqual(USDC_DOMAIN);
    expect(t.primaryType).toBe("Permit");
    expect(t.message).toEqual({ owner: USER, spender: ROUTER, value: "10000000", nonce: "3", deadline: "99" });
  });

  it("reads the nonce from USDC, and words a refusal, a failure and a non-signature", async () => {
    net({ rpc: (m, p) => (m === "eth_call" && (p[0] as { to: string }).to === USDC.address ? `0x${"0".repeat(63)}2` : undefined) });
    const sig = `0x${"ab".repeat(65)}`;
    let asked: unknown[] = [];
    const ok = { request: async (a: { method: string; params?: unknown[] }) => { asked = a.params!; return sig; } };
    expect(await signPermit(ok, USER, ROUTER, 5n, 9n)).toBe(sig);
    expect(JSON.parse(String(asked[1])).message.nonce).toBe("2");
    const throwing = (e: unknown) => ({ request: async () => { throw e; } });
    await expect(signPermit(throwing(Object.assign(new Error("no"), { code: 4001 })), USER, ROUTER, 5n, 9n)).rejects.toThrow("You declined the USDC signature. Nothing was sent.");
    await expect(signPermit(throwing(new Error("locked")), USER, ROUTER, 5n, 9n)).rejects.toThrow("Your wallet did not sign the USDC permit (locked). Nothing was sent.");
    await expect(signPermit(throwing("odd"), USER, ROUTER, 5n, 9n)).rejects.toThrow("(odd)");
    await expect(signPermit(throwing(null), USER, ROUTER, 5n, 9n)).rejects.toThrow("(null)");
    await expect(signPermit({ request: async () => "0x12" }, USER, ROUTER, 5n, 9n)).rejects.toThrow("not a signature");
    await expect(signPermit({ request: async () => 7 }, USER, ROUTER, 5n, 9n)).rejects.toThrow("not a signature");
  });

  it("buys tokens, never ETH", async () => {
    await expect(routerLeg(ROUTER, USER, { kind: "native", symbol: "ETH", decimals: 18 } as never, 5n, 100)).rejects.toThrow();
  });
});
