import { assertChecksummedAddress, hasAddressShape, toChecksumAddress } from "@/lib/address";
import { addressOf, fullName } from "@/skills/names";

/**
 * What a person typed where an address goes: an address, or a Basename.
 *
 * Anything with the SHAPE of an address is treated as one and goes through the same
 * EIP-55 door as every other address in this repo — a contradicted checksum is refused,
 * never "helpfully" resolved as a name. Anything else is tried as a Basename; `jesse` means
 * `jesse.base.eth`.
 */
export type Target = {
  /** checksummed */
  readonly address: string;
  /** the Basename it came from, when it came from one */
  readonly via: string | null;
};

export async function resolveTarget(text: string, label: string): Promise<Target> {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error(`${label}: type an address or a Basename.`);
  if (hasAddressShape(trimmed) || trimmed.startsWith("0x")) {
    return { address: toChecksumAddress(assertChecksummedAddress(trimmed, label)), via: null };
  }
  const name = fullName(trimmed);
  const address = await addressOf(name);
  if (address === null) throw new Error(`${label}: no Basename called ${name} points to an address.`);
  return { address: toChecksumAddress(address), via: name };
}
