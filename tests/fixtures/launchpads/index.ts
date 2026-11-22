/**
 * Real answers from the launchpads' own records on Base, captured 2026-10-14 and not edited.
 *
 * MEASURED, not written (the rule in ../base/index.ts). base.blockscout.com answered this machine
 * with a Cloudflare challenge (403) all that day, so everything here is the chain's own answer, and
 * the contracts were named from their verified sources on Sourcify:
 *
 *   curl -s "https://sourcify.dev/server/v2/contract/8453/<address>?fields=abi,compilation,sources"
 *
 * rpc-records.json — for each token, an `eth_call` on base.publicnode.com at "latest" to:
 *   basepad  0xad60…307F infoOf(token)
 *   doppler  0x660e…8D12 getAssetData(token)            (Doppler's Airlock)
 *   clanker  0xE85A…83a9 deploymentInfoForToken(token)
 *   zora     0x7777…baF3 getVersionForDeployedCoin(token)
 *   tokenFactory         token.factory()                 (a basepad LaunchToken names its factory)
 *   originalAdmin        token.originalAdmin()           (a Clanker v4 token's named admin; captured
 *                                                         2026-11-04 the same way — BOAR's is NOT its launcher)
 * the raw result hex, or the node's `error` (a revert). The tokens:
 *   basepadToken 0xaeAd…106d — the token the DelegationManager bug was measured on (launch #3106859)
 *   feelToken    0xc5A5…FeE1 — a Feel.cash launch from api.feel.cash/v1/launches (officialFeelLaunch: true)
 *   dopplerToken 0x13f6…2ba3 — the Doppler token of the 2026-10-01 verdict captures (another integrator)
 *   clankerToken 0x3e02…eb07 — launched 2026-10-14 through an ERC-4337 bundle, hook ClankerHookStaticFeeV2
 *   boar         0x0cbf…Bb07 — the Clanker token of the 2026-10-01 verdict captures
 *   zoraCoin     0xfda6…7aa3 — launched 2026-10-14, the emitter of a CoinCreatedV4 log from Zora's factory
 *   degen        DEGEN — a direct deploy: every record empty, and factory() reverts
 *
 * rpc-code.json — `eth_getCode(<address>, "latest")` on base.publicnode.com: BOAR's launcher
 *   0xd9aC…6e58 (a plain wallet, "0x") and the owner's wallet 0xD5C1…3FAB (an EIP-7702 delegation).
 *
 * rpc-pad-logs.json — `eth_getLogs` on base.publicnode.com, the radar's request for basepad's
 *   `Launched` and the Airlock's `Create` over 600 blocks (52,586,586–52,587,185): two Doppler
 *   creates. No basepad launch fell in any window publicnode would serve (its newest, at block
 *   52,559,877 by basepad's own API, was older than publicnode's recent range, and mainnet.base.org
 *   answered "request limit reached" to every retry that day), so a basepad log is built in the test.
 */
import records from "./rpc-records.json";
import padLogs from "./rpc-pad-logs.json";
import code from "./rpc-code.json";
import { BASEPAD, CLANKER_FACTORY, CLANKER_V5_FACTORY, DOPPLER_AIRLOCK, FLAUNCH_CONTRACTS, MINT_CLUB_BOND, VIRTUALS_CONTRACTS, ZORA_FACTORY } from "@/config/launchpads";
import { RpcError } from "../../net";

export const PX = { records, padLogs, code };

export const PADS_TOKENS = {
  basepadToken: "0xaeadc7084bc3c482921a8ad7eadc65f70e06106d",
  feelToken: "0xc5a548eed3c4785ec98f63781ceffba6bc5dfee1",
  dopplerToken: "0x13f6D7bf6491E21Db7c7B51043843953D7902ba3",
  clankerToken: "0x3e0245c41365877e27f81dcaf2d6019d35f4eb07",
  boar: "0x0cbf291Ba052174879d90bf781dF1A5F2BC5Bb07",
  zoraCoin: "0xfda6fcde53cc2d50b9ecf99eb451b48687dd7aa3",
  degen: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
} as const;

export type Captured = keyof typeof records;
type Record = (typeof records)[Captured];
const PAD_OF: { [to: string]: keyof Record } = {
  [BASEPAD.factory.toLowerCase()]: "basepad",
  [DOPPLER_AIRLOCK.toLowerCase()]: "doppler",
  [CLANKER_FACTORY.toLowerCase()]: "clanker",
  [ZORA_FACTORY.toLowerCase()]: "zora",
};

const ZERO_WORD = "0x" + "0".repeat(64);
const ZERO_THREE_WORDS = "0x" + "0".repeat(64 * 3);
const answer = (a: unknown) => (typeof a === "string" ? a : new RpcError((a as { error: { message: string } }).error.message));

/**
 * An `eth_call` router for the four launchpads' records and a token's `factory()`. Each token named
 * in `as` answers as the captured token it stands for; any other token answers as DEGEN did (empty).
 */
export function padCalls(as: { [token: string]: Captured } = {}): (method: string, params: readonly unknown[]) => unknown {
  const table = new Map(Object.entries(as).map(([t, c]) => [t.toLowerCase(), c]));
  const stand = (t: string): Record => records[table.get(t.toLowerCase()) ?? (Object.entries(PADS_TOKENS).find(([, a]) => a.toLowerCase() === t.toLowerCase())?.[0] as Captured) ?? "degen"];
  return (method, params) => {
    if (method !== "eth_call") return undefined;
    const call = params[0] as { to: string; data: string; from?: string };
    if (call.from) return undefined;
    const to = call.to.toLowerCase();
    if (to === CLANKER_V5_FACTORY.toLowerCase()) return answer(records.degen.clanker);
    if (to in FLAUNCH_CONTRACTS) return ZERO_WORD;
    if (to in VIRTUALS_CONTRACTS) return ZERO_THREE_WORDS;
    if (to === MINT_CLUB_BOND.toLowerCase()) return ZERO_WORD;
    const pad = PAD_OF[to];
    if (pad) return answer(stand(`0x${call.data.slice(34, 74)}`)[pad]);
    // factory() — the selector computed with `cast sig "factory()"`
    if (call.data === "0xc45a0155") return answer(stand(call.to).tokenFactory);
    // originalAdmin() — `cast sig "originalAdmin()"`
    if (call.data === "0x1c7b2ff4") return answer(stand(call.to).originalAdmin);
    return undefined;
  };
}
