import { checkAddress, hasAddressShape, toChecksumAddress } from "@/lib/address";
import { accountKind, type AccountKind } from "@/lib/erc20";
import { chainToken } from "@/skills/chaintoken";
import { explorer, short } from "@/skills/format";
import { nameOf, type ReverseName } from "@/skills/names";
import { lureOf, transfersOf, type Moved } from "@/skills/profile";
import { resolveTarget } from "@/skills/target";
import { row, type Report, type Row, type Skill } from "@/skills/types";

/**
 * Send Check — before money moves, is this the address you mean? (2026-10-02, one of the six x402
 * tools the owner chose after the Bazaar was measured: a pre-send check is the "trust" call agents
 * are told to make, and nobody sells a good one on Base.)
 *
 * It answers from four facts, each a row: whether the typed address is the one its own checksum
 * says; what is there (a wallet, a wallet with an EIP-7702 delegation, a contract — and a TOKEN
 * contract, where tokens sent are usually lost); whether its Basename points back; and, given the
 * sender's address, whether the recipient is a LOOK-ALIKE of somebody the sender really pays, or was
 * planted in the sender's history by a fake transfer. MEASURED 2026-10-02 on the owner's own wallet:
 * fake "ETH" sent to 0x00FDCd…746F, an address sharing its first four and last four characters with
 * the owner's deployer 0x00FD29…746F — the exact copy-from-history trap this exists to catch.
 */

/** How many characters at each end an address-poisoning look-alike copies (MEASURED: four and four). */
export const LOOKALIKE_EDGE = 4;

/** Two different addresses that share their first and last characters — the look-alike pattern. */
export function looksAlike(a: string, b: string): boolean {
  const x = a.toLowerCase().slice(2);
  const y = b.toLowerCase().slice(2);
  return x !== y && x.slice(0, LOOKALIKE_EDGE) === y.slice(0, LOOKALIKE_EDGE) && x.slice(-LOOKALIKE_EDGE) === y.slice(-LOOKALIKE_EDGE);
}

export type History = {
  /** addresses the sender really exchanged tokens with */
  readonly real: ReadonlySet<string>;
  /** addresses a fake ("lure") transfer named as if the sender had paid them */
  readonly planted: ReadonlySet<string>;
};

/** The sender's counterparties, split into real ones and the ones a poisoning campaign planted. */
export function historyOf(sender: string, moved: readonly Moved[]): History {
  const me = sender.toLowerCase();
  const real = new Set<string>();
  const planted = new Set<string>();
  for (const m of moved) {
    const other = (m.from.toLowerCase() === me ? m.to : m.from).toLowerCase();
    if (other === me) continue;
    if (lureOf(m.symbol, m.token)) planted.add(other);
    else real.add(other);
  }
  return { real, planted };
}

/** What the sender's history says about this recipient, as one row. */
export function historyRow(recipient: string, h: History): Row {
  const r = recipient.toLowerCase();
  if (h.planted.has(r)) {
    return row("Your history", "this address was PLANTED in your history by a fake transfer — address poisoning. Do not send.", { tone: "bad" });
  }
  const twin = [...h.real].find((x) => looksAlike(x, r));
  if (twin) {
    return row("Your history", `a LOOK-ALIKE of ${toChecksumAddress(twin)}, which you really used — same first and last characters, different address. Do not send.`, {
      tone: "bad",
      href: explorer.address(toChecksumAddress(twin)),
    });
  }
  if (h.real.has(r)) return row("Your history", "you have exchanged tokens with this address before", { tone: "ok" });
  return row("Your history", "no token transfers with you on record — a first payment: compare every character with where you got it");
}

export function kindRow(kind: AccountKind, token: { symbol: string } | null): Row {
  if (kind.kind === "wallet") return row("What is there", "a wallet", { tone: "ok" });
  if (kind.kind === "delegated") return row("What is there", `a wallet with an EIP-7702 delegation to ${short(kind.to)} — an ordinary wallet with a smart-account feature`, { tone: "ok" });
  if (token) return row("What is there", `the ${token.symbol} TOKEN contract — tokens sent to a token's own address are usually lost`, { tone: "bad" });
  return row("What is there", "a contract — send only if you mean to pay this contract", { tone: "warn" });
}

export function nameRow(name: ReverseName): Row {
  if (name.kind === "none") return row("Basename", "none");
  if (name.kind === "verified") return row("Basename", `${name.name} — resolves back to this address`, { tone: "ok" });
  return row("Basename", `${name.name} claims this address but points to ${name.pointsTo ?? "nothing"} — a false claim`, { tone: "bad" });
}

export function decisionRow(rows: readonly Row[]): Row {
  if (rows.some((r) => r.tone === "bad")) return row("Decision", "Do not send — see the red lines", { tone: "bad" });
  if (rows.some((r) => r.tone === "warn")) return row("Decision", "Check before sending — see the amber lines", { tone: "warn" });
  return row("Decision", "No red flags found", { tone: "ok" });
}

const settled = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);
const notChecked = (label: string, what: string) => row(label, `not checked — ${what} could not be read`, { tone: "warn" });

export async function sendCheck(recipientText: string, senderText = ""): Promise<Report> {
  const typed = recipientText.trim();
  const body: Row[] = [];
  // the checksum is judged on what was TYPED, before anything is resolved or lowercased
  if (hasAddressShape(typed)) {
    const c = checkAddress(typed);
    if (c.kind === "mismatch") {
      const r = [row("Checksum", "the capitalisation contradicts the address's own checksum — a typo or a tampered copy", { tone: "bad" })];
      return { title: `Send Check — ${typed}`, rows: [decisionRow(r), ...r], notes: ["Nothing else was read: a contradicted checksum is enough to stop."], sources: ["EIP-55 (computed here)"] };
    }
    body.push(
      c.kind === "checksummed"
        ? row("Checksum", "matches — no character was mistyped", { tone: "ok" })
        : row("Checksum", "none to check (all one case) — compare every character", { tone: "warn" }),
    );
  }
  const target = await resolveTarget(typed, "Recipient");
  const address = target.address;
  const sender = senderText.trim() === "" ? null : toChecksumAddress((await resolveTarget(senderText, "Your address")).address);

  const [kind, name, moved] = await Promise.all([
    settled(accountKind(address)),
    settled(nameOf(address)),
    sender ? settled(transfersOf(sender)) : Promise.resolve(null),
  ]);
  const token = kind?.kind === "contract" ? await chainToken(address).then((t) => ({ symbol: t.symbol }), () => null) : null;

  if (target.via) body.push(row("Name", `${target.via} resolves to this address`));
  body.push(kind ? kindRow(kind, token) : notChecked("What is there", "the account's code"));
  body.push(name ? nameRow(name) : notChecked("Basename", "the reverse record"));
  if (sender) {
    if (address.toLowerCase() === sender.toLowerCase()) body.push(row("Your history", "this is your own address", { tone: "warn" }));
    else body.push(moved ? historyRow(address, historyOf(sender, moved)) : notChecked("Your history", "your token history"));
  }

  return {
    title: `Send Check — ${address}`,
    rows: [decisionRow(body), row("Recipient", address, { href: explorer.address(address) }), ...body],
    notes: [
      "Address poisoning sends you fake transfers from look-alike addresses so that you copy one from your history. Copy an address from where it was given to you, never from a list of past transactions.",
      ...(sender ? ["Your history is the newest page of your token transfers; a look-alike of an older counterparty can be missed."] : ["Give your own address too, and the check also looks for look-alikes of the addresses you really pay."]),
      '"No red flags found" is not a guarantee: it cannot know whether the person who gave you the address is who they say.',
    ],
    sources: ["EIP-55 (computed here)", "Base (account code, Basenames)", ...(sender ? ["Blockscout (your token transfers)"] : [])],
    next: [
      // no button to pay an address the check says not to pay
      ...(body.some((r) => r.tone === "bad") ? [] : [{ label: "Send to it", command: `send ${address}` }]),
      { label: "Its profile", command: `profile ${address}` },
    ],
  };
}

export const sendCheckSkill: Skill = {
  id: "sendcheck",
  title: "Send Check",
  summary: "Before you pay: is this the address you mean — checksum, what is there, its Basename, and look-alikes of who you really pay.",
  args: [
    { name: "recipient", hint: "0x… or name.base.eth" },
    { name: "your address", hint: "0x… — also checks your history for look-alikes", optional: true },
  ],
  run: ([recipient = "", sender = ""]) => sendCheck(recipient, sender),
};
