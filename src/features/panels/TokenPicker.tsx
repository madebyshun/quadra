import { USDC, WETH } from "@/config/chain";
import { assertChecksummedAddress, sameAddress } from "@/lib/address";
import { formatAmount } from "@/lib/amount";
import { balanceOf, ETH, ETH_GAS_RESERVE, readToken, type Asset } from "@/lib/erc20";

/**
 * Which token, as a money form asks it: the three `config/chain.ts` has verified addresses
 * for (hard rule 1), or any other by its address — never by its ticker (hard rule 2).
 */

export type Choice = "ETH" | "USDC" | "WETH" | "other";

/**
 * USDC and WETH as the verified config states them (`tests/chain.test.ts` pins both, decimals
 * included) — so choosing one costs no RPC round-trip. Anything else is read from its contract.
 */
const KNOWN: Record<"USDC" | "WETH", Asset> = {
  USDC: { kind: "erc20", address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
  WETH: { kind: "erc20", address: WETH.address, symbol: WETH.symbol, decimals: WETH.decimals },
};

/** The asset a choice names — from verified config for the known ones, read from the chain for any other. */
export async function assetFor(choice: Choice, typed: string, label: string): Promise<Asset> {
  if (choice === "ETH") return ETH;
  if (choice !== "other") return KNOWN[choice];
  return readToken(assertChecksummedAddress(typed, label));
}

export function TokenPicker({
  label,
  choice,
  address,
  customLabel,
  onChoice,
  onAddress,
}: {
  label: string;
  choice: Choice;
  address: string;
  customLabel?: string | null;
  onChoice: (c: Choice) => void;
  onAddress: (a: string) => void;
}) {
  return (
    <>
      <label className="group__row">
        <span>{label}</span>
        <select className="field" aria-label={label} value={choice} onChange={(e) => onChoice(e.target.value as Choice)}>
          <option value="ETH">ETH</option>
          <option value="USDC">USDC</option>
          <option value="WETH">WETH</option>
          <option value="other">{customLabel || "0x…"}</option>
        </select>
      </label>
      {choice === "other" ? (
        <label className="group__row">
          <span>{label} address</span>
          <input
            className="field"
            aria-label={`${label} address`}
            placeholder="0x…"
            spellCheck={false}
            value={address}
            onChange={(e) => onAddress(e.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

/** Which picker choice names this token — ETH is `null`; anything but USDC/WETH is "other". */
export function choiceFor(address: string | null): Choice {
  if (address === null) return "ETH";
  if (sameAddress(address, USDC.address)) return "USDC";
  if (sameAddress(address, WETH.address)) return "WETH";
  return "other";
}

/**
 * `pct` percent of what `account` holds of the chosen token, as the text an Amount field takes.
 * Read from the chain at the click, not from the list above (an indexer, seconds behind), and
 * truncated, never rounded up. "Max" on ETH keeps `ETH_GAS_RESERVE` back for the gas.
 */
export async function amountFor(choice: Choice, typed: string, label: string, account: string, pct: number): Promise<string> {
  const asset = await assetFor(choice, typed, label);
  const held = await balanceOf(asset, account);
  let amount = (held * BigInt(pct)) / 100n;
  if (asset.kind === "native" && pct === 100) amount = amount > ETH_GAS_RESERVE ? amount - ETH_GAS_RESERVE : 0n;
  return formatAmount(amount, asset.decimals);
}

export const PERCENTS = [25, 50, 75, 100] as const;

/**
 * 25% / 50% / 75% / Max. `pending` is the one being read: it shows "…" and the others wait, so a
 * click always visibly does something — the balance read is a round-trip to the chain.
 */
export function PercentButtons({ onPick, disabled, pending = null }: { onPick: (pct: number) => void; disabled: boolean; pending?: number | null }) {
  return (
    <div className="group__row group__row--actions" role="group" aria-label="Amount shortcuts">
      <span />
      {PERCENTS.map((p) => (
        <button
          key={p}
          type="button"
          className="chip"
          aria-label={p === 100 ? "Max" : `${p}%`}
          aria-busy={pending === p}
          onClick={() => onPick(p)}
          disabled={disabled || pending !== null}
        >
          {pending === p ? "…" : p === 100 ? "Max" : `${p}%`}
        </button>
      ))}
    </div>
  );
}
