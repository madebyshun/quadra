/**
 * A real launch, read 2026-10-02 about an hour after its pool opened: VampCoin (VAMP), a "no hook"
 * Uniswap v4 pool against ETH — the case Launch Forensics was written from.
 *
 *   T=0xE51D24C8795c21D9f119A81625820a30048a3387
 *   eth_getLogs T [Transfer] blocks 52,073,587 – 52,073,647 on mainnet.base.org     # rpc-transfers-vamp (fields read only)
 *   curl -s "https://api.dexscreener.com/tokens/v1/base/$T"                        # dexscreener-vamp (trimmed)
 *   name/symbol/decimals/totalSupply eth_call on T; for the first 19 buyers
 *   eth_getTransactionCount, eth_getCode (first 32 bytes), balanceOf on T, at block 52,074,178   # rpc-reads-vamp
 *
 * MEASURED in it: 96.8% of the supply in the token's own contract at the window's end, one
 * transaction spraying dust to 101 addresses, and the first buyers sharing an EIP-7702 delegate.
 * Never edit these to make a test pass — a variant is built in the test, visibly.
 */
import transfers from "./rpc-transfers-vamp.json";
import dex from "./dexscreener-vamp.json";
import reads from "./rpc-reads-vamp.json";

export const FX_VAMP = { transfers, dex, reads };
export const VAMP = "0xE51D24C8795c21D9f119A81625820a30048a3387";
export const VAMP_LAUNCH_BLOCK = 52_073_587;
