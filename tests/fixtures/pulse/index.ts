/**
 * Base's latest block as `eth_getBlockByNumber("latest", false)` answered, captured 2026-10-14:
 *
 *   curl -s -X POST https://mainnet.base.org -H 'content-type: application/json' \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}'
 *
 * Trimmed to the five fields `parsePulse` reads plus `transactions` — cut from 156 hashes to the
 * first 4 (so the pulse counts 4; the count is the list's length, whatever it holds).
 */
import block from "./rpc-block-latest.json";

export const PX = { block };
