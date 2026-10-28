import { decodeFunctionResult, encodeFunctionData, namehash } from "viem";
import { normalize } from "viem/ens";
import { BASENAMES } from "@/config/chain";
import { ethCall } from "@/skills/http";

/**
 * Basenames: name → address and address → name, read straight from Base.
 *
 * 🔴 A reverse record is a CLAIM, not a fact. Anyone can set their address's reverse record
 * to any name, including one they do not own. So `nameOf` resolves the name it finds
 * FORWARD again and only reports it when that forward answer is the same address — the
 * check every ENS client is supposed to make and many skip. A name that fails it comes
 * back as `unverified`, with the name, so the panel can say so rather than hide it.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

const REGISTRY_ABI = [
  { type: "function", name: "resolver", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

const RESOLVER_ABI = [
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "string" }] },
] as const;

async function resolverOf(node: `0x${string}`): Promise<string | null> {
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "resolver", args: [node] });
  const out = decodeFunctionResult({ abi: REGISTRY_ABI, functionName: "resolver", data: await ethCall(BASENAMES.registry, data) });
  return out === ZERO ? null : out;
}

/** `jesse` → `jesse.base.eth`; a name with a dot is taken as written. Lowercased and ENS-normalised. */
export function fullName(text: string): string {
  const trimmed = text.trim();
  return normalize(trimmed.includes(".") ? trimmed : `${trimmed}.base.eth`);
}

/** The address a Basename points to, or `null` when it has no resolver or no address. */
export async function addressOf(name: string): Promise<string | null> {
  const node = namehash(fullName(name));
  const resolver = await resolverOf(node);
  if (resolver === null) return null;
  const data = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "addr", args: [node] });
  const out = decodeFunctionResult({ abi: RESOLVER_ABI, functionName: "addr", data: await ethCall(resolver, data) });
  return out === ZERO ? null : out;
}

export type ReverseName =
  | { readonly kind: "none" }
  /** the reverse record names it, and the name points back here */
  | { readonly kind: "verified"; readonly name: string }
  /** the reverse record names it, but the name points somewhere else — or nowhere */
  | { readonly kind: "unverified"; readonly name: string; readonly pointsTo: string | null };

export async function nameOf(address: string): Promise<ReverseName> {
  const node = namehash(`${address.toLowerCase().slice(2)}.${BASENAMES.reverseSuffix}`);
  const resolver = await resolverOf(node);
  if (resolver === null) return { kind: "none" };
  const data = encodeFunctionData({ abi: RESOLVER_ABI, functionName: "name", args: [node] });
  const name = decodeFunctionResult({ abi: RESOLVER_ABI, functionName: "name", data: await ethCall(resolver, data) });
  if (name === "") return { kind: "none" };
  const pointsTo = await addressOf(name);
  return pointsTo !== null && pointsTo.toLowerCase() === address.toLowerCase()
    ? { kind: "verified", name }
    : { kind: "unverified", name, pointsTo };
}
