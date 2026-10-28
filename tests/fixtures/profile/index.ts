/**
 * The owner's wallet `0xD5C1…3FAB` as Blockscout saw it on 2026-10-02 at 09:05 UTC, trimmed to the
 * fields read and to the first 16 transfers / a handful of balances. Public chain data.
 *
 *   A=0xD5C1dFc036F9911348EA8065F73c8123f4013FAB
 *   curl -s "https://base.blockscout.com/api/v2/addresses/$A/token-transfers?type=ERC-20"   # blockscout-transfers-owner
 *   curl -s "https://base.blockscout.com/api/v2/addresses/$A/token-balances"                # blockscout-balances-owner
 *
 * 🔴 The transfers are an ADDRESS-POISONING campaign against this wallet, MEASURED: a token named
 * "ETH" at 0xecA9… that is not ETH, and "E឵Τ឵H", "ꓴ឵ՏᎠ឵Ꮳ", "U឵S឵Dꓚ" — symbols built from look-alike
 * letters and invisible U+17B5 — "sent" from the owner to addresses that share their first and last
 * characters with ones the owner really uses (0x00FDCd… against the deployer 0x00FD29…). Never edit
 * these to tidy them: the odd characters ARE the test.
 */
import transfersOwner from "./blockscout-transfers-owner.json";
import balancesOwner from "./blockscout-balances-owner.json";

export const PX = { transfersOwner, balancesOwner };

export const OWNER = "0xD5C1dFc036F9911348EA8065F73c8123f4013FAB";
/** The fake "ETH" token in the capture — read from it, never typed. */
export const FAKE_ETH = transfersOwner.items.find((i) => i.token.symbol === "ETH")!.token.address_hash;
