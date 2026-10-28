import { describe, expect, it } from "vitest";
import type { Note } from "@/adapters/types";
import { balanceOf, inToken, largestPayment, pickNote } from "@/lib/balance";
import { USDC, WETH } from "@/config/chain";

/**
 * Only the fields these functions read are real; the rest is cast away. A full
 * `Note` needs a commitment from the hash seam, and none of that is what is under
 * test here — which note gets chosen is.
 */
function note(id: string, amount: bigint, address: string = USDC.address): Note {
  return { id, amount, token: { address, symbol: "X", decimals: 6 } } as unknown as Note;
}

describe("balanceOf / largestPayment", () => {
  it("sums the balance and finds the most one payment can move", () => {
    const held = [note("a", 7n), note("b", 5n)];
    expect(balanceOf(held)).toBe(12n);
    expect(largestPayment(held)).toBe(7n);
  });

  it("is zero for nothing, rather than throwing on an empty reduce", () => {
    expect(balanceOf([])).toBe(0n);
    expect(largestPayment([])).toBe(0n);
  });
});

describe("pickNote", () => {
  const held = [note("seven", 7n), note("five", 5n), note("twenty", 20n)];

  /** Tightest fit keeps the large notes whole — see the function's note. */
  it("takes the smallest note that covers the amount", () => {
    expect(pickNote(held, 4n)?.id).toBe("five");
    expect(pickNote(held, 6n)?.id).toBe("seven");
    expect(pickNote(held, 8n)?.id).toBe("twenty");
  });

  it("takes an exact fit, which leaves no change behind", () => {
    expect(pickNote(held, 7n)?.id).toBe("seven");
  });

  /** Two equal notes: the first listed wins, so the choice is stable, not random. */
  it("keeps the first of two equal fits", () => {
    expect(pickNote([note("x", 5n), note("y", 5n)], 5n)?.id).toBe("x");
  });

  it("answers null when no single note covers it, even if the total would", () => {
    expect(pickNote([note("a", 7n), note("b", 5n)], 10n)).toBeNull();
    expect(pickNote([], 1n)).toBeNull();
  });
});

describe("inToken", () => {
  /**
   * An address's case is its EIP-55 checksum, not part of its identity. A note stored
   * with a lowercased address is the same token, and dropping it from the balance would
   * make money disappear from the screen.
   */
  it("matches the token's address case-blind", () => {
    const lower = note("lower", 1n, USDC.address.toLowerCase());
    expect(inToken([lower], USDC.address)).toEqual([lower]);
  });

  it("leaves notes in any other token out", () => {
    const usdc = note("usdc", 1n);
    expect(inToken([usdc, note("weth", 1n, WETH.address)], USDC.address)).toEqual([usdc]);
  });
});
