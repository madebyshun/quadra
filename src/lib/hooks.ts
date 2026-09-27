/**
 * What a Uniswap v4 hook is allowed to do, read out of its address.
 *
 * v4 encodes a hook's permissions in the low 14 bits of its own address. The pool
 * manager checks those bits to decide which callbacks to fire, so they are not a
 * claim the hook makes — they are the thing the pool actually obeys. A hook whose
 * `beforeSwap` bit is clear cannot run code before a swap even if it implements
 * the function, because it is never called.
 *
 * That is why this module exists and why it needs no network: the permissions are
 * in the address, and deploying to a chosen address (mining a salt for CREATE2) is
 * how a hook gets them. Reading them is arithmetic.
 *
 * ── The limit, stated plainly ───────────────────────────────────────────────
 * These bits say WHICH callbacks run, never WHAT they do. A hook with only
 * `beforeSwap` set can still take every token in the swap. The bits bound the
 * surface, they do not audit the code. Any UI over this has to say so, or it
 * turns a permission list into a safety claim it cannot support.
 *
 * Flag positions are v4-core's `Hooks.sol`. They are consensus-critical and
 * cannot be changed without changing the pool manager, so hard-coding them here
 * is safe in a way that hard-coding an address never is.
 *
 * The table itself lives in the MCP manifest rather than in this file, because the
 * stdio server decodes addresses too and runs under bare `node` with no build
 * step — it cannot import TypeScript. One table read by both beats two tables and
 * a test to keep them equal. See `lib/manifest.ts` for why the direction is that
 * way round. The positions are still pinned individually in `tests/hooks.test.ts`.
 */

import { type AddressCheck, checkAddress } from "@/lib/address";
import { MCP_HOOK_PERMISSIONS } from "@/lib/manifest";

export type HookPermission = {
  /** bit position within the low 14 bits */
  bit: number;
  /** the callback's name in v4-core */
  name: string;
  /** what it means for the person swapping, in their words */
  means: string;
};

export const HOOK_PERMISSIONS: readonly HookPermission[] = MCP_HOOK_PERMISSIONS;

/** The 14 bits v4 reserves. Anything above these is just part of the address. */
export const ALL_HOOK_BITS = 14;

/**
 * The one wording for a bad address, shared by the throw below and by any caller
 * that would rather check than catch. One constant because the message appears
 * next to a text field, and two copies of it drift.
 *
 * Kept local rather than taken from `lib/address.ts` because it names the field —
 * "hook address" — and a panel about hooks saying "a name or a ticker never does" would
 * be answering a question nobody asked here.
 */
export const NOT_AN_ADDRESS = "That is not an address. Paste a 20-byte 0x… hook address.";

/**
 * What is wrong with a pasted hook address, or `null` if nothing is.
 *
 * ⚠️ **The EIP-55 check matters here even though no money moves.** Mistype one character
 * of a hook address and this panel reads the permission bits of a *different* address and
 * reports them with total confidence — most likely as `inert`, which is the reassuring
 * answer. "No permissions, you are safe" about an address that is not the hook is worse
 * than an error, because the user acts on it. A read that cannot fail is exactly the kind
 * that needs its input checked.
 *
 * A lowercase address still passes, because it carries no checksum to contradict; the
 * reading records which case it was so the panel can say so.
 */
export function hookAddressProblem(raw: string): string | null {
  const checked = checkAddress(raw);
  switch (checked.kind) {
    case "malformed":
      return NOT_AN_ADDRESS;
    case "mismatch":
      return checked.why;
    case "unchecked":
    case "checksummed":
      return null;
  }
}

/**
 * Whether `readHookAddress` will succeed.
 *
 * Defined in terms of `hookAddressProblem` rather than repeating the check, because the
 * panel calls this one and then calls the reader — and if the two ever disagreed, the
 * reader's throw would reach the user as a blank screen. `tests/hooks.test.ts` asserts
 * they agree; defining one through the other is what makes that assertion cheap to keep
 * true rather than a thing to remember.
 */
export function isHookAddress(raw: string): boolean {
  return hookAddressProblem(raw) === null;
}

export type Granted = HookPermission & { granted: boolean };

export type HookReading = {
  address: string;
  /** every permission, granted or not — the absent ones are the reassuring part */
  permissions: readonly Granted[];
  /** just the granted ones, in v4's own order */
  granted: readonly Granted[];
  /**
   * True when no bit is set. Such an address is a valid pool with no hook at all;
   * `0x0000…0000` is the ordinary case and means exactly this.
   */
  inert: boolean;
  /**
   * Whether the pasted spelling carried an EIP-55 checksum, and whether it matched.
   *
   * On the reading rather than only in the validator, because `inert` is a reassuring
   * word and the user deserves to know how sure this is about *which* address it read.
   * Can only be `unchecked` or `checksummed` here — a `mismatch` throws above.
   */
  checksum: AddressCheck;
};

/**
 * Read an address's hook bits.
 *
 * Throws on anything that is not a 20-byte address, or whose checksum is contradicted,
 * rather than returning an empty reading — because "no permissions" and "you pasted a
 * transaction hash" must not look the same on screen, the first being reassuring and the
 * second a mistake. Same argument extends to a typo: "no permissions" about the wrong
 * address is the most dangerous output this panel can produce.
 */
export function readHookAddress(raw: string): HookReading {
  const address = raw.trim();
  const problem = hookAddressProblem(address);
  if (problem !== null) throw new Error(problem);

  const bits = BigInt(address) & ((1n << BigInt(ALL_HOOK_BITS)) - 1n);
  const permissions = HOOK_PERMISSIONS.map((p) => ({
    ...p,
    granted: (bits & (1n << BigInt(p.bit))) !== 0n,
  }));

  return {
    address,
    permissions,
    granted: permissions.filter((p) => p.granted),
    inert: bits === 0n,
    checksum: checkAddress(address),
  };
}
