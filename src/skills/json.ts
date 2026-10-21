/** Reading a service's JSON without trusting its shape: every accessor tolerates absence. */

export type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** `v[key]` as an object, or `{}`. */
export const objAt = (v: unknown, key: string): Json => {
  const inner = isObj(v) ? v[key] : undefined;
  return isObj(inner) ? inner : {};
};

/** A non-empty string, or `null`. */
export const strOf = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A decimal-digit string as a bigint, or `null`. */
export const bigOf = (v: unknown): bigint | null =>
  typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null;

/** A finite number from a number or numeric string, or `null`. */
export const numOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** An array, or `[]`. */
export const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
