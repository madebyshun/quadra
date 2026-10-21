import { BRAND } from "@/brand";
import { assertChecksummedAddress, toChecksumAddress } from "@/lib/address";
import { chainToken } from "@/skills/chaintoken";
import { markets } from "@/skills/dexscreener";
import { explorer } from "@/skills/format";
import { launchesBy, launchOf, launchpadOrigin } from "@/skills/launchpad";
import { launcherProfile, originOf, type Origin } from "@/skills/origin";
import { launchpadOf } from "@/skills/launchpads";
import { originRows } from "@/skills/verdict";
import { row, type Report, type Row, type Skill } from "@/skills/types";

/**
 * Launcher — who is behind a coin, and what they have done before: wallet age, how many launches,
 * whether they have ever pulled liquidity, who funded them, and their launches on this app's own
 * launchpad. Given a TOKEN it finds the launcher (the factory's record for a launchpad coin, else
 * the launch transaction); given a WALLET it reads that wallet. MEASURED 2026-10-02 on the market:
 * deployer reputation sells (Arkham ~$1.19 a call; RobinX grades deployers on Robinhood Chain only)
 * and nobody sells it for Base with a liquidity-pull record.
 */

export function reputationRow(rows: readonly Row[]): Row {
  if (rows.some((r) => r.tone === "bad")) return row("Reputation", "Red flags — see the red lines", { tone: "bad" });
  if (rows.some((r) => r.tone === "warn")) return row("Reputation", "Caution — see the amber lines", { tone: "warn" });
  return row("Reputation", "No red flags found", { tone: "ok" });
}

type Found = { readonly what: "token" | "wallet"; readonly origin: Origin | null };

/** A token's origin, or a wallet read as its own launcher. */
async function find(address: string): Promise<Found> {
  const ours = await launchOf(address);
  if (ours) return { what: "token", origin: await launchpadOrigin(ours) };
  const pairs = await markets(address).catch(() => []);
  const isToken = pairs.length > 0 || (await chainToken(address).then(() => true, () => false));
  if (!isToken) return { what: "wallet", origin: { via: null, launcher: await launcherProfile(address, null) } };
  // the launchpad that PROVES it made the token names it — never the launch transaction's `to`
  // (records that could not be read leave the generic path, which no longer trusts a relay's `to` either)
  const pad = await launchpadOf(address, Promise.resolve(null)).catch(() => null);
  return { what: "token", origin: await originOf(address, pairs, pad?.kind === "proven" ? pad : null) };
}

export async function launcherReport(input: string, now: number): Promise<Report> {
  const address = toChecksumAddress(assertChecksummedAddress(input.trim(), "Token or wallet"));
  const { what, origin } = await find(address);
  const launcher = origin?.launcher ?? null;
  const here = launcher ? await launchesBy(launcher.address).catch(() => null) : null;
  const body: Row[] = [
    ...originRows(origin, now),
    ...(launcher === null
      ? []
      : here === null
        ? [row(`On ${BRAND.name}'s launchpad`, "not checked — its launches could not be read", { tone: "warn" })]
        : [row(`On ${BRAND.name}'s launchpad`, `${here.launches.length}${here.complete ? "" : "+"} ${here.launches.length === 1 ? "launch" : "launches"}`)]),
  ];
  return {
    title: `Launcher — ${what === "token" ? `of ${address}` : address}`,
    rows: [reputationRow(body), row(what === "token" ? "Token" : "Wallet", address, { href: what === "token" ? explorer.token(address) : explorer.address(address) }), ...body],
    notes: [
      "A launcher that has taken liquidity out of a pool before is red; a new wallet, or one that launches token after token, is amber. Read from the wallet's own history on Blockscout — the newest page when it is long.",
      '"No red flags found" is about the record, not a promise about the next launch.',
    ],
    sources: ["Blockscout", "DexScreener", "Base (the launch transaction, this app's launchpad)"],
    next: [
      ...(launcher ? [{ label: "The launcher's profile", command: `profile ${launcher.address}` }] : []),
      ...(what === "token" ? [{ label: "Token Verdict", command: `verdict ${address}` }] : []),
    ],
  };
}

export const launcherSkill: Skill = {
  id: "launcher",
  title: "Launcher",
  summary: "Who is behind a coin and their record: wallet age, launches, liquidity pulls, funder — from a token or a wallet.",
  args: [{ name: "token or wallet", hint: "0x…" }],
  run: ([input = ""]) => launcherReport(input, Date.now()),
};
