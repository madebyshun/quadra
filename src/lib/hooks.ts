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

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The one wording for a bad address, shared by the throw below and by any caller
 * that would rather check than catch. One constant because the message appears
 * next to a text field, and two copies of it drift.
 */
export const NOT_AN_ADDRESS = "That is not an address. Paste a 20-byte 0x… hook address.";

export function isHookAddress(raw: string): boolean {
  return ADDRESS.test(raw.trim());
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
};

/**
 * Read an address's hook bits.
 *
 * Throws on anything that is not a 20-byte address rather than returning an empty
 * reading, because "no permissions" and "you pasted a transaction hash" must not
 * look the same on screen — the first is reassuring and the second is a mistake.
 */
export function readHookAddress(raw: string): HookReading {
  const address = raw.trim();
  if (!isHookAddress(address)) throw new Error(NOT_AN_ADDRESS);

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
  };
}
