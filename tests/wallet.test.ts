import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  chooseAccount,
  connectWallet,
  releaseAccounts,
  injectedProvider,
  parseChainId,
  readWallet,
  requestBaseChain,
  WALLET_EVENTS,
  watchWallet,
  type Eip1193Provider,
  type Eip1193Request,
} from "@/lib/wallet";
import { BASE } from "@/config/chain";

/**
 * The wallet connection, against providers that misbehave in the specific ways real
 * ones do.
 *
 * Every test here drives a fake provider rather than a global, because the interesting
 * behaviour is entirely in what this module concludes from an answer — and the answers
 * worth testing are the wrong ones. A wallet that returns a lowercase address on Base is
 * the easy case and one test covers it; the rest of this file is a locked wallet, a
 * declined prompt, a chain id spelled three different ways, a switch that resolved
 * successfully without switching, and a provider that can subscribe but not unsubscribe.
 */

/** An address in the mixed case a checksummed wallet would hand back. */
const ACCOUNT = "0xabCDeF0123456789AbcdEf0123456789aBCDEF01";
const LOWER = ACCOUNT.toLowerCase();

/**
 * A provider error. `code` is the field EIP-1193 defines and every branch of `errorCode`
 * reads, so it is a parameter rather than baked in.
 */
function rpcError(code: number | string, message = "provider said no"): Error {
  return Object.assign(new Error(message), { code });
}

type Answers = Record<string, unknown>;

/**
 * A fake provider driven by a method → answer map.
 *
 * A function answer is called, so a test can throw from inside `request` — which is how
 * a provider actually reports a rejection, and the only way to reach the `catch` arms.
 * An unstubbed method throws a message naming itself rather than returning `undefined`:
 * an accidental `undefined` would read as a provider answering strangely, and this file's
 * whole job is to distinguish those.
 */
function fake(answers: Answers, events?: "on-only" | "none") {
  const calls: Eip1193Request[] = [];
  const listeners: { event: string; handler: (...args: unknown[]) => void }[] = [];
  const provider: Eip1193Provider = {
    request(args) {
      calls.push(args);
      if (!(args.method in answers)) {
        return Promise.reject(new Error(`test did not stub ${args.method}`));
      }
      const answer = answers[args.method];
      return typeof answer === "function"
        ? Promise.resolve((answer as () => unknown)())
        : Promise.resolve(answer);
    },
  };
  if (events !== "none") {
    provider.on = (event, handler) => void listeners.push({ event, handler });
  }
  if (events === undefined) {
    provider.removeListener = (event, handler) => {
      const at = listeners.findIndex((l) => l.event === event && l.handler === handler);
      if (at >= 0) listeners.splice(at, 1);
    };
  }
  return { provider, calls, listeners, methods: () => calls.map((c) => c.method) };
}

/** A provider that is connected, on Base, with nothing unusual about it. */
const onBase = (account: unknown = LOWER) =>
  fake({ eth_accounts: [account], eth_chainId: BASE.idHex });

describe("finding the injected provider", () => {
  it("is null when nothing is injected", () => {
    expect(injectedProvider({})).toBeNull();
  });

  it("is null when `ethereum` is not an object", () => {
    expect(injectedProvider({ ethereum: "metamask" })).toBeNull();
  });

  it("is null when `ethereum` is null", () => {
    expect(injectedProvider({ ethereum: null })).toBeNull();
  });

  /**
   * An extension can assign anything to that name. Without this branch the object would
   * reach `provider.request(...)` and throw a TypeError from inside an async function,
   * which surfaces as an unhandled rejection rather than as a state the panel renders.
   */
  it("is null when `ethereum` has no callable request", () => {
    expect(injectedProvider({ ethereum: { isMetaMask: true } })).toBeNull();
  });

  it("is the provider when it has one", () => {
    const { provider } = onBase();
    expect(injectedProvider({ ethereum: provider })).toBe(provider);
  });

  /** The default argument is the real path: in a browser `globalThis` *is* `window`. */
  it("reads globalThis by default, which is what a wallet writes to", () => {
    const { provider } = onBase();
    vi.stubGlobal("ethereum", provider);
    expect(injectedProvider()).toBe(provider);
  });
});

describe("reading a chain id", () => {
  it("reads the hex EIP-695 specifies", () => {
    expect(parseChainId("0x2105")).toBe(8453n);
  });

  /**
   * The two tests that justify parsing instead of comparing the string. Both spellings
   * below are the right chain, and `answer === BASE.idHex` calls both of them wrong.
   */
  it("reads a non-minimal hex as the same chain", () => {
    expect(parseChainId("0x02105")).toBe(8453n);
  });

  it("reads upper and lower case hex as the same chain", () => {
    expect(parseChainId("0xA4B1")).toBe(parseChainId("0xa4b1"));
  });

  /**
   * Config coherence, and it is load-bearing rather than tidy. `readWallet` compares
   * against `BASE.id` while `requestBaseChain` asks the wallet for `BASE.idHex`. If those
   * two ever disagreed, a switch would succeed and the next read would still say
   * `wrongChain` — a loop with no error anywhere in it.
   */
  it("agrees with the decimal chain id in config", () => {
    expect(parseChainId(BASE.idHex)).toBe(BigInt(BASE.id));
  });

  it("trims surrounding whitespace", () => {
    expect(parseChainId(" 0x2105 ")).toBe(8453n);
  });

  /**
   * Refused because it is ambiguous, not because it is unusual: this string is chain 2105
   * read as decimal and chain 8453 read as un-prefixed hex, and nothing can tell which
   * was meant. See the note on `parseChainId` for why `errorCode` is deliberately more
   * generous than this.
   */
  it("refuses a decimal string", () => {
    expect(parseChainId("2105")).toBeNull();
    expect(parseChainId("8453")).toBeNull();
  });

  it("refuses a number, an object, null and undefined", () => {
    expect(parseChainId(8453)).toBeNull();
    expect(parseChainId({ chainId: "0x2105" })).toBeNull();
    expect(parseChainId(null)).toBeNull();
    expect(parseChainId(undefined)).toBeNull();
  });

  it("refuses `0x` with no digits, which BigInt would throw on", () => {
    expect(parseChainId("0x")).toBeNull();
    expect(parseChainId("2105")).toBeNull();
    expect(parseChainId("0xnope")).toBeNull();
  });
});

describe("reading the wallet without prompting", () => {
  it("says there is nothing to ask when no provider is injected", async () => {
    const state = await readWallet(null);
    expect(state.kind).toBe("unavailable");
    if (state.kind !== "unavailable") throw new Error("unreachable");
    expect(state.why).toMatch(/Install a browser wallet/);
    /** The one sentence a user without a wallet most needs: the free tools still work. */
    expect(state.why).toMatch(/Free tools need no wallet/);
  });

  it("is ready when connected on Base, and lowercases the account", async () => {
    const state = await readWallet(onBase(ACCOUNT).provider);
    expect(state).toEqual({ kind: "ready", account: LOWER });
  });

  /**
   * `ready` carries no chain id, the same decision `PaymentRequirements` makes about
   * `network`. Asserted structurally so a later "just add chainId for the panel" cannot
   * land quietly — a checked chain has nothing left to report, and a field that repeats
   * a passed assertion is a field something will eventually re-derive a verdict from.
   */
  it("keeps no chain id once the chain has been checked", async () => {
    const state = await readWallet(onBase().provider);
    expect(Object.keys(state).sort()).toEqual(["account", "kind"]);
  });

  it("is ready on a non-minimal hex chain id", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: "0x02105" });
    expect((await readWallet(provider)).kind).toBe("ready");
  });

  it("is disconnected when no account is authorised", async () => {
    const state = await readWallet(fake({ eth_accounts: [] }).provider);
    expect(state.kind).toBe("disconnected");
    if (state.kind !== "disconnected") throw new Error("unreachable");
    expect(state.why).toMatch(/nothing is charged until you sign/);
  });

  /**
   * A locked wallet answering `null` is disconnected, not broken. See `firstAccount`:
   * connecting is the fix either way, and "unlock your wallet" said to somebody whose
   * wallet is not locked is the instruction they cannot follow.
   */
  it("is disconnected when the accounts answer is not even an array", async () => {
    expect((await readWallet(fake({ eth_accounts: null }).provider)).kind).toBe("disconnected");
  });

  /**
   * The ordering the module documents, asserted rather than described. Reading the chain
   * first would tell a first-time visitor to switch networks before asking them to
   * connect — and it would cost a second request in the state every visitor starts in.
   */
  it("never asks for the chain when there is no account", async () => {
    const wallet = fake({ eth_accounts: [] });
    await readWallet(wallet.provider);
    expect(wallet.methods()).toEqual(["eth_accounts"]);
  });

  it("fails, with the wallet's own words, when it will not list accounts", async () => {
    const { provider } = fake({
      eth_accounts: () => {
        throw rpcError(-32603, "wallet is locked");
      },
    });
    const state = await readWallet(provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/did not answer when asked which accounts/);
    expect(state.why).toMatch(/\(wallet is locked\)/);
  });

  /** A rejection that is not an `Error` has no message to quote, so none is invented. */
  it("omits the parenthetical when the rejection carries no message", async () => {
    const { provider } = fake({
      eth_accounts: () => {
        throw { code: -32603 };
      },
    });
    const state = await readWallet(provider);
    if (state.kind !== "failed") throw new Error("expected failed");
    expect(state.why).not.toMatch(/\(/);
  });

  it("omits the parenthetical when the Error's message is empty", async () => {
    const { provider } = fake({
      eth_accounts: () => {
        throw new Error("");
      },
    });
    const state = await readWallet(provider);
    if (state.kind !== "failed") throw new Error("expected failed");
    expect(state.why).not.toMatch(/\(/);
  });

  it("fails when the wallet will not say which chain it is on", async () => {
    const { provider } = fake({
      eth_accounts: [LOWER],
      eth_chainId: () => {
        throw rpcError(-32603, "no network");
      },
    });
    const state = await readWallet(provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/which chain it is on/);
  });

  /**
   * The distinction this module exists to keep: an unreadable chain id is not the wrong
   * chain. Collapsing them tells somebody already on Base to switch to Base, so the
   * absence of that instruction is the substance of the test and not a flourish.
   *
   * The first written form of this asserted `not.toMatch(/wrong network/i)` and failed,
   * because the sentence *denies* being that claim in those words. Same trap as a doc
   * comment matching the grep it recommends: assert on the instruction a user would act
   * on, not on a phrase that also appears in the disclaimer.
   */
  it("does not tell an unreadable chain id to switch networks", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: "8453" });
    const state = await readWallet(provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/"8453"/);
    expect(state.why).toMatch(/not a claim that you are on the wrong network/);
    expect(state.why).not.toMatch(/Switch to Base/);
  });

  /**
   * `0x` followed by three hundred nines parses fine and is simply a chain nobody runs,
   * so the long answer that reaches `shown` has to be a *non-hex* one — which is the
   * more realistic shape anyway, an error page or a JSON blob where a chain id belonged.
   */
  it("caps an absurd chain id answer before putting it in a sentence", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: "z".repeat(300) });
    const state = await readWallet(provider);
    if (state.kind !== "failed") throw new Error("expected failed");
    expect(state.why).toMatch(/…/);
    expect(state.why.length).toBeLessThan(400);
  });

  it("reports a hex chain id that is merely enormous as the wrong chain", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: `0x${"9".repeat(40)}` });
    expect((await readWallet(provider)).kind).toBe("wrongChain");
  });

  it("reports the wrong chain with the chain it is actually on", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: "0x1" });
    const state = await readWallet(provider);
    expect(state.kind).toBe("wrongChain");
    if (state.kind !== "wrongChain") throw new Error("unreachable");
    expect(state.chainId).toBe(1n);
    expect(state.why).toMatch(/on chain 1\b/);
    expect(state.why).toMatch(/Base \(8453\)/);
  });

  /**
   * Claims only what is certain. Some wallets compare `domain.chainId` against the
   * selected network and refuse outright, others sign something Base will not settle —
   * so the sentence covers both rather than picking the more alarming mechanism and
   * stating it as fact.
   */
  it("describes the wrong chain without inventing which way it fails", async () => {
    const { provider } = fake({ eth_accounts: [LOWER], eth_chainId: "0x1" });
    const state = await readWallet(provider);
    if (state.kind !== "wrongChain") throw new Error("expected wrongChain");
    expect(state.why).toMatch(/either refuses to sign it or signs something Base will never accept/);
  });
});

describe("an account this build will not sign from", () => {
  it("refuses a non-string where an address was expected", async () => {
    const state = await readWallet(onBase(null).provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/answered null where an account address was expected/);
  });

  it("refuses something that is not an address at all", async () => {
    const state = await readWallet(onBase("my-wallet").provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/will not sign from/);
  });

  /**
   * The case that justifies checking at all, rather than taking the string. A
   * contradicted EIP-55 checksum would otherwise be caught by `addressToUint` deep
   * inside `encodeAuthorization`, as a thrown error mid-signature with no state for the
   * panel to render. Same address as the mixed-case fixture, one digit changed.
   */
  it("refuses an address whose checksum contradicts its case", async () => {
    const mangled = `${ACCOUNT.slice(0, -1)}2`;
    const state = await readWallet(onBase(mangled).provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/EIP-55 checksum/);
    expect(state.why).toMatch(/do not fix the capitalisation/);
  });
});

describe("connecting", () => {
  it("has nothing to ask without a provider", async () => {
    expect((await connectWallet(null)).kind).toBe("unavailable");
  });

  it("prompts, then reads the whole state back", async () => {
    const wallet = fake({
      eth_requestAccounts: [LOWER],
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    const state = await connectWallet(wallet.provider);
    expect(state).toEqual({ kind: "ready", account: LOWER });
    expect(wallet.methods()).toEqual(["eth_requestAccounts", "eth_accounts", "eth_chainId"]);
  });

  /**
   * The return value of `eth_requestAccounts` is discarded, and here it is a lie: the
   * prompt resolves with no accounts while the wallet has one. A build that trusted the
   * resolution would report `disconnected` to somebody who just connected — and, more to
   * the point, the resolution says nothing at all about the chain, so trusting it can
   * only ever produce half a verdict.
   */
  it("ignores what the prompt resolved with and believes the measurement", async () => {
    const wallet = fake({
      eth_requestAccounts: [],
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect(await connectWallet(wallet.provider)).toEqual({ kind: "ready", account: LOWER });
  });

  it("carries the wrong chain out of a successful connect", async () => {
    const wallet = fake({ eth_requestAccounts: [LOWER], eth_accounts: [LOWER], eth_chainId: "0x1" });
    expect((await connectWallet(wallet.provider)).kind).toBe("wrongChain");
  });

  it("says you declined, rather than that something went wrong", async () => {
    const { provider } = fake({
      eth_requestAccounts: () => {
        throw rpcError(4001, "User rejected the request.");
      },
      eth_accounts: [],
    });
    const state = await connectWallet(provider);
    expect(state.kind).toBe("disconnected");
    if (state.kind !== "disconnected") throw new Error("unreachable");
    expect(state.why).toMatch(/You declined the connection request/);
    expect(state.why).toMatch(/nothing was charged/);
  });

  /**
   * The double-click case. A second prompt does not open, and telling the user to try
   * again is the one instruction that makes it worse — the answer is in a window they
   * cannot see.
   */
  it("points at the window already asking, on a pending request", async () => {
    const { provider } = fake({
      eth_requestAccounts: () => {
        throw rpcError(-32002);
      },
      eth_accounts: [],
    });
    const state = await connectWallet(provider);
    if (state.kind !== "disconnected") throw new Error("expected disconnected");
    expect(state.why).toMatch(/already has a request open/);
  });

  it("reads a numeric string code, since the cost of missing one is only a worse sentence", async () => {
    const { provider } = fake({
      eth_requestAccounts: () => {
        throw rpcError("4001");
      },
      eth_accounts: [],
    });
    const state = await connectWallet(provider);
    if (state.kind !== "disconnected") throw new Error("expected disconnected");
    expect(state.why).toMatch(/You declined/);
  });

  it("leaves the measured sentence alone for an error it cannot classify", async () => {
    for (const thrown of [rpcError(-1), new Error("boom"), "boom", null, { code: {} }, { code: "nope" }]) {
      const { provider } = fake({
        eth_requestAccounts: () => {
          throw thrown;
        },
        eth_accounts: [],
      });
      const state = await connectWallet(provider);
      if (state.kind !== "disconnected") throw new Error("expected disconnected");
      expect(state.why).toMatch(/No account is connected yet/);
    }
  });

  /**
   * A measurement beats an error code. The prompt rejected, but by the time the read
   * lands there is an account on Base — the user approved it in the wallet's own window,
   * or a second tab did. Reporting the rejection here would be reporting the past.
   */
  it("reports ready when the read contradicts the rejection", async () => {
    const { provider } = fake({
      eth_requestAccounts: () => {
        throw rpcError(4001);
      },
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect(await connectWallet(provider)).toEqual({ kind: "ready", account: LOWER });
  });

  /**
   * The other state that is never relabelled. A broken provider now is more current and
   * more urgent than why the last request was refused, so "you declined" must not
   * overwrite it.
   */
  it("keeps a failure rather than relabelling it with the rejection", async () => {
    const { provider } = fake({
      eth_requestAccounts: () => {
        throw rpcError(4001);
      },
      eth_accounts: () => {
        throw rpcError(-32603, "wallet is locked");
      },
    });
    const state = await connectWallet(provider);
    expect(state.kind).toBe("failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    expect(state.why).toMatch(/wallet is locked/);
    expect(state.why).not.toMatch(/You declined/);
  });
});

/**
 * The account picker, and letting go of the site's access.
 *
 * MEASURED by the owner 2026-09-30: with MetaMask connected there was no way to reach a second
 * MetaMask account — `eth_requestAccounts` answers at once with the account already granted.
 * `wallet_requestPermissions` opens the picker every time.
 */
describe("choosing an account", () => {
  it("has nothing to ask without a provider", async () => {
    expect((await chooseAccount(null)).kind).toBe("unavailable");
  });

  it("asks for the eth_accounts permission, which opens the picker, then reads the state back", async () => {
    const wallet = fake({ wallet_requestPermissions: [{ parentCapability: "eth_accounts" }], eth_accounts: [LOWER], eth_chainId: BASE.idHex });
    expect(await chooseAccount(wallet.provider)).toEqual({ kind: "ready", account: LOWER });
    expect(wallet.calls[0]).toEqual({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  });

  it.each([4200, -32601, "4200"])("falls back to eth_requestAccounts when the wallet has no picker (%s)", async (code) => {
    const wallet = fake({
      wallet_requestPermissions: () => {
        throw rpcError(code);
      },
      eth_requestAccounts: [LOWER],
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect((await chooseAccount(wallet.provider)).kind).toBe("ready");
    expect(wallet.methods()).toContain("eth_requestAccounts");
  });

  it("says a closed picker was the user's choice, and measures what is left", async () => {
    const wallet = fake({
      wallet_requestPermissions: () => {
        throw rpcError(4001);
      },
      eth_accounts: [],
    });
    const state = await chooseAccount(wallet.provider);
    expect(state.kind).toBe("disconnected");
    if (state.kind !== "disconnected") throw new Error("unreachable");
    expect(state.why).toMatch(/You declined the connection request/);
  });

  it("keeps the account already granted when the picker is closed, because that is what is true", async () => {
    const wallet = fake({
      wallet_requestPermissions: () => {
        throw rpcError(4001);
      },
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect(await chooseAccount(wallet.provider)).toEqual({ kind: "ready", account: LOWER });
  });
});

describe("releasing the site's access", () => {
  it("asks the wallet to revoke eth_accounts", async () => {
    const wallet = fake({ wallet_revokePermissions: null });
    await releaseAccounts(wallet.provider);
    expect(wallet.calls).toEqual([{ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }]);
  });

  it("never throws: a wallet without the method, or no wallet at all, just keeps its grant", async () => {
    await expect(releaseAccounts(fake({}).provider)).resolves.toBeUndefined();
    await expect(releaseAccounts(null)).resolves.toBeUndefined();
  });
});

describe("asking for Base", () => {
  it("has nothing to ask without a provider", async () => {
    expect((await requestBaseChain(null)).kind).toBe("unavailable");
  });

  it("asks for the chain id in config, then measures the result", async () => {
    const wallet = fake({
      wallet_switchEthereumChain: null,
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect(await requestBaseChain(wallet.provider)).toEqual({ kind: "ready", account: LOWER });
    expect(wallet.calls[0]).toEqual({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE.idHex }],
    });
  });

  /**
   * The whole reason this function re-reads. EIP-3326 has a successful switch resolve
   * `null`, and this provider resolves `null` while staying on chain 1 — which is what a
   * wallet does when it decides to leave you where you were. A build that treated the
   * resolution as success would report Base and then sign for a chain it is not on.
   */
  it("does not believe a null resolution that did not switch anything", async () => {
    const wallet = fake({
      wallet_switchEthereumChain: null,
      eth_accounts: [LOWER],
      eth_chainId: "0x1",
    });
    const state = await requestBaseChain(wallet.provider);
    expect(state.kind).toBe("wrongChain");
    if (state.kind !== "wrongChain") throw new Error("unreachable");
    expect(state.chainId).toBe(1n);
  });

  /**
   * 4902 means the wallet has no Base to switch to. The sentence has to say so, and has
   * to say why this build will not add it: `wallet_addEthereumChain` writes an RPC endpoint
   * into the user's wallet that then carries their Base traffic on every other site too.
   *
   * The assertions below match the *shape* of that sentence and never the product name, so
   * a rename does not touch this file. That is the whole point of `src/brand.ts`.
   */
  it("explains a missing network, and that it will not add it for you", async () => {
    const { provider } = fake({
      wallet_switchEthereumChain: () => {
        throw rpcError(4902, "Unrecognized chain ID");
      },
      eth_accounts: [LOWER],
      eth_chainId: "0x1",
    });
    const state = await requestBaseChain(provider);
    expect(state.kind).toBe("wrongChain");
    if (state.kind !== "wrongChain") throw new Error("unreachable");
    expect(state.why).toMatch(/does not have Base \(8453\) configured/);
    expect(state.why).toMatch(/deliberately does not add it for you/);
    expect(state.why).toMatch(/outlives this page/);
  });

  it("points at a pending switch prompt", async () => {
    const { provider } = fake({
      wallet_switchEthereumChain: () => {
        throw rpcError(-32002);
      },
      eth_accounts: [LOWER],
      eth_chainId: "0x1",
    });
    const state = await requestBaseChain(provider);
    if (state.kind !== "wrongChain") throw new Error("expected wrongChain");
    expect(state.why).toMatch(/already has a request open/);
  });

  it("leaves the measured sentence alone for a switch error it cannot classify", async () => {
    const { provider } = fake({
      wallet_switchEthereumChain: () => {
        throw rpcError(4001);
      },
      eth_accounts: [LOWER],
      eth_chainId: "0x1",
    });
    const state = await requestBaseChain(provider);
    if (state.kind !== "wrongChain") throw new Error("expected wrongChain");
    expect(state.why).toMatch(/Switch to Base before paying/);
  });

  /**
   * The relabel is stale by the time it would be applied: the wallet said it had no Base,
   * the user added it and switched, and the read says so. An error code describes the
   * instant it was thrown, which is why the measurement wins.
   */
  it("reports ready when the user fixed it while the error was in flight", async () => {
    const { provider } = fake({
      wallet_switchEthereumChain: () => {
        throw rpcError(4902);
      },
      eth_accounts: [LOWER],
      eth_chainId: BASE.idHex,
    });
    expect(await requestBaseChain(provider)).toEqual({ kind: "ready", account: LOWER });
  });
});

describe("noticing that the wallet moved", () => {
  it("subscribes to every event worth re-reading for", () => {
    const wallet = fake({});
    watchWallet(() => {}, wallet.provider);
    expect(wallet.listeners.map((l) => l.event)).toEqual([...WALLET_EVENTS]);
  });

  it("covers accounts, chain, connect and disconnect", () => {
    expect([...WALLET_EVENTS]).toEqual([
      "accountsChanged",
      "chainChanged",
      "connect",
      "disconnect",
    ]);
  });

  /**
   * The doorbell rule, asserted. `chainChanged` fires with a chain id and
   * `accountsChanged` with accounts, and each is half a verdict — a fresh account paired
   * with a stale chain, or the reverse. The wrapper makes the zero-argument contract
   * structural, so a handler cannot start leaning on a payload even if its signature
   * later widens.
   */
  it("calls back with no arguments, whatever the event carried", () => {
    const wallet = fake({});
    const seen: unknown[][] = [];
    watchWallet(
      (...args: unknown[]) => void seen.push(args),
      wallet.provider,
    );
    for (const listener of wallet.listeners) listener.handler("0x1", [LOWER]);
    expect(seen).toEqual([[], [], [], []]);
  });

  /**
   * Removes the very function object it added, which is the only version of this that
   * works. The fake's `removeListener` splices on reference equality, so an empty list is
   * the assertion — hand `removeListener` a fresh arrow and a real provider keeps firing
   * forever with nothing in the API to say so.
   *
   * Note what is deliberately *not* asserted: that calling a retained handler after `stop`
   * does nothing. It still does, because the closure is alive and unsubscribing is the
   * provider forgetting it rather than the function becoming inert. The first draft
   * asserted exactly that and failed — a test that would have been measuring the fake.
   */
  it("removes the very handler it added, leaving nothing subscribed", () => {
    const wallet = fake({});
    let calls = 0;
    const stop = watchWallet(() => void calls++, wallet.provider);
    for (const listener of wallet.listeners) listener.handler();
    expect(calls).toBe(WALLET_EVENTS.length);
    stop();
    expect(wallet.listeners).toEqual([]);
  });

  it("is a no-op with no provider, rather than a throw", () => {
    expect(() => watchWallet(() => {}, null)()).not.toThrow();
  });

  /**
   * The events are a SHOULD in EIP-1193 and some wrappers ship `request` alone. Such a
   * wallet still works — the panel just updates when something else re-reads — so this
   * degrades instead of refusing.
   */
  it("is a no-op for a provider with no events at all", () => {
    const wallet = fake({}, "none");
    expect(() => watchWallet(() => {}, wallet.provider)()).not.toThrow();
  });

  /**
   * `on` without `removeListener` is refused rather than used, and `on` is never called.
   * A subscription that cannot be cancelled is worse than no subscription inside a React
   * effect: the handler outlives the component and calls `setState` on something that is
   * gone.
   */
  it("refuses to subscribe when it could not unsubscribe", () => {
    const wallet = fake({}, "on-only");
    expect(() => watchWallet(() => {}, wallet.provider)()).not.toThrow();
    expect(wallet.listeners).toEqual([]);
  });
});

/**
 * The boundary this module keeps, checked in its source rather than promised in a comment.
 *
 * ⚠️ Deliberately **not** a ban on `eth_signTypedData_v4`. That call is where T4 is going,
 * and a test that forbids the next planned commit is a test somebody deletes without
 * reading. What is pinned is the set of things that must never appear here no matter what
 * lands next, and the sharpest of them is `eth_sign`: signing a 32-byte digest through it
 * would produce exactly the same signature as `eth_signTypedData_v4` while showing the
 * user opaque bytes instead of the amount and the recipient. Anything that hides the
 * payment from the person authorising it is the one thing this whole file is arranged to
 * prevent.
 *
 * `\b` matters in the regex: `eth_sign` is a prefix of `eth_signTypedData_v4`, so a
 * substring check would ban the method this module is meant to grow.
 */
describe("what this module is not allowed to become", () => {
  /** From the working directory, for the reason `tests/mcp.test.ts` records: Vite rewrites
   * this file's own URL to an `http://` one inside jsdom, so `fileURLToPath` throws on it. */
  const SOURCE = readFileSync(resolve(process.cwd(), "src/lib/wallet.ts"), "utf8");

  it.each([
    "eth_sign",
    "personal_sign",
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "privateKey",
    "PRIVATE_KEY",
    "mnemonic",
  ])("never mentions %s", (forbidden) => {
    expect(
      SOURCE,
      "if this tripped on a comment, reword the comment — the check is literal",
    ).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
  });

  /** The control: the regex would catch the real thing if it were there. */
  it("would catch a banned method if one appeared", () => {
    expect('provider.request({ method: "eth_sign" })').toMatch(/\beth_sign\b/);
    expect('provider.request({ method: "eth_signTypedData_v4" })').not.toMatch(/\beth_sign\b/);
  });
});
