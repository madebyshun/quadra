/**
 * Money is bigint base units plus the token's decimals, never a float.
 *
 * This exists because of one specific hazard already documented in config/pair.ts:
 * AAPLc has 8 decimals while USDC has 6 and WETH has 18. A float path that gets
 * the exponent wrong misprices by 10^10, which does not look like a bug in the
 * output — it looks like a 10-billion-x price move, so nothing downstream rejects
 * it. Every conversion therefore takes `decimals` explicitly; there is no default.
 */

/** Digits and at most one dot. No sign, no exponent, no separators. */
const DECIMAL = /^\d*\.?\d*$/;

export function parseAmount(input: string, decimals: number): bigint {
  assertDecimals(decimals);

  const text = input.trim();
  if (!text || text === ".") throw new Error("Enter an amount.");
  if (!DECIMAL.test(text)) {
    throw new Error(`"${input}" is not a plain decimal number.`);
  }

  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(
      `This token has ${decimals} decimals, so ${fraction.length} decimal places cannot be represented. Nothing was rounded.`,
    );
  }

  const padded = fraction.padEnd(decimals, "0");
  return BigInt(`${whole || "0"}${padded}`);
}

export function formatAmount(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (value < 0n) throw new Error("Amount cannot be negative.");

  if (decimals === 0) return value.toString();

  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Rejects a decimals value that could only come from a bug. 8 and 18 are both
 * legitimate here, so the check cannot be "is it 18" — it can only be a range.
 */
function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`decimals must be an integer in 0..36, got ${decimals}.`);
  }
}
