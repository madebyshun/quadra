import { useCallback, useEffect, useState } from "react";
import { BaseLaunch } from "@/features/panels/BaseLaunch";
import { factoryState, launchPairs, o1Up, prepareLaunch, type Extra, type FactoryState, type LaunchPlan } from "@/adapters/http/o1";
import { BASE } from "@/config/chain";
import { CRYPTO_PAIRS, EXTRA, O1, type Pair } from "@/config/o1";
import { toChecksumAddress } from "@/lib/address";
import { formatAmount } from "@/lib/amount";
import { accountKind } from "@/lib/erc20";
import { messageOf } from "@/lib/errors";
import { explorer } from "@/skills/format";
import { row, type Report } from "@/skills/types";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";
import { useWalletSession } from "@/ui/WalletProvider";
import { ReportView } from "@/features/panels/ReportView";
import { TxStepList, useTxSteps } from "@/features/panels/TxSteps";

export type LaunchMode = "base" | "o1";

/**
 * Two ways to launch, both on Base: this app's own launchpad (the owner's decision of 2026-10-02 —
 * "build our own, not o1"; `BaseLaunch.tsx`) first, and o1 beside it. `aria-pressed` chips, the
 * same as the x402 window's halves.
 */
export function LaunchPanel({ start = "base" }: { start?: LaunchMode } = {}) {
  const [mode, setMode] = useState<LaunchMode>(start);
  return (
    <div className="stack">
      <div className="group__row group__row--actions" role="group" aria-label="Launch on">
        <button type="button" className="chip chip--mode" aria-pressed={mode === "base"} onClick={() => setMode("base")}>
          Base launchpad
        </button>
        <button type="button" className="chip chip--mode" aria-pressed={mode === "o1"} onClick={() => setMode("o1")}>
          o1
        </button>
      </div>
      {mode === "base" ? <BaseLaunch /> : <O1Launch />}
    </div>
  );
}

/**
 * Put a coin out on o1 from the connected wallet, on Base. Always public — the owner's rule,
 * 2026-09-30: the token, its creator and every trade are on Base for anyone.
 *
 * Paired with a crypto asset (ETH, USDC, cbBTC — o1's `standard` market) or with one of the
 * stock tokens o1 registers on Base (its `rwa` market; docs.o1.exchange/launchpad/create/
 * stock-paired-launches). Whichever is picked, the window reads o1's factory ON BASE for it —
 * creation open, the fee, the pair registered — so the answer does not depend on o1's API,
 * which was down all of 2026-09-30.
 *
 * Three moves: fill the form → **Prepare** (this app's server asks o1, which validates,
 * pins the image and metadata to IPFS, simulates, and returns unsigned steps) → **Launch**
 * (the wallet signs each step). Between the two, `checkPlan` has already refused anything
 * that is not a plain transaction to o1's verified factory, for this wallet, on Base, with
 * no more ETH than the creation fee — and the review shows what was checked.
 *
 * Prepare is rate-limited by o1 (3 a minute, 25 a day per creator) and pins files to IPFS
 * each time, so the button is not something to press to "see what happens"; the form's
 * blockers keep it disabled until the launch is actually filled in.
 */

/** o1's limits, from its spec: name 1–50, symbol 1–11 with no spaces, image ≤ 2 MB. */
const NAME_MAX = 50;
const SYMBOL = /^\S{1,11}$/;
const IMAGE_MAX = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const DESCRIPTION_BYTES = 2000;

/** The link patterns o1's spec accepts, word for word — a link it would refuse is caught here. */
const LINKS = {
  Website: { pattern: /^https?:\/\/[^/]*\.[^/]+(?:\/.*)?$/, says: "Website must be a full https:// link" },
  X: { pattern: /^https?:\/\/(?:www\.)?x\.com\/.+/, says: "X must be an x.com link" },
  Telegram: { pattern: /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/.+/, says: "Telegram must be a t.me link" },
} as const;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The extra rows as o1 will get them — blank rows dropped — or the first thing o1 would refuse. */
export function checkExtra(rows: readonly Extra[]): { readonly extra: Extra[] } | { readonly problem: string } {
  const extra = rows.map((r) => ({ key: r.key.trim(), value: r.value.trim() })).filter((r) => r.key !== "" || r.value !== "");
  if (extra.some((r) => r.key === "")) return { problem: "Give every extra row a key" };
  if (new Set(extra.map((r) => r.key)).size !== extra.length) return { problem: "Extra keys must all be different" };
  if (extra.some((r) => r.key.length > EXTRA.key)) return { problem: `An extra key is over ${EXTRA.key} characters` };
  if (extra.some((r) => r.value.length > EXTRA.value)) return { problem: `An extra value is over ${EXTRA.value} characters` };
  if (extra.reduce((n, r) => n + bytes(r.key) + bytes(r.value), 0) > EXTRA.bytes) return { problem: `Extra information is over ${EXTRA.bytes} bytes` };
  return { extra };
}

type Image = { readonly base64: string; readonly type: string; readonly name: string };

/** A picked file as base64, or a sentence saying why o1 would refuse it. */
export async function readImage(file: File): Promise<Image> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("The image must be PNG, JPEG, WebP or GIF.");
  if (file.size > IMAGE_MAX) throw new Error("The image must be 2 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), type: file.type, name: file.name };
}

function planReport(plan: LaunchPlan, creator: string, pair: Pair, extra: number): Report {
  const stock = pair.market === "rwa";
  return {
    title: `${plan.name} (${plan.symbol}) — ready to launch`,
    rows: [
      row("Token address", `${plan.token} (predicted — it exists once the launch confirms)`),
      row("Paired with", `${pair.symbol} on ${BASE.name} — ${stock ? `a stock token (${pair.name})` : "crypto"}, checked against the plan`),
      row("Creation fee", `${formatAmount(plan.creationFee, 18)} ETH, paid to o1 in the launch transaction`),
      row("Creator", toChecksumAddress(creator), { href: explorer.address(toChecksumAddress(creator)) }),
      row("Sends to", `o1's factory ${O1.factory} — checked, verified on Blockscout`, { href: explorer.address(O1.factory), tone: "ok" }),
      row("Profile editing", plan.editable ? "on — you can change the token's profile later, and nothing else" : "off — the profile is fixed at launch"),
      ...(extra > 0 ? [row("Extra information", `${extra} ${extra === 1 ? "entry" : "entries"}, public in the token's profile`)] : []),
      row("Signatures", `${plan.steps.length}`),
      ...(plan.imageUrl ? [row("Image", plan.imageUrl, { href: plan.imageUrl })] : []),
      row("Metadata", plan.metadataUri),
      row("Prepare again after", plan.expiresAt.toLocaleTimeString()),
    ],
    notes: [
      "Public: the token, your address as its creator and every trade are visible on Base to anyone.",
      ...(stock ? [`Stock-paired: the token trades against ${pair.symbol}, and the trading fees you earn as creator arrive in ${pair.symbol}.`] : []),
      "Your wallet shows each transaction again. Gas is extra, on top of the creation fee.",
      ...plan.warnings.map((w) => `o1: ${w}`),
    ],
    sources: ["o1 launch API (through this app's server)", `o1's factory on ${BASE.name} (read directly)`],
  };
}

/** What the factory said about the picked pair, in one line. */
function pairLine(pair: Pair, state: FactoryState | string | null): { text: string; tone: "dim" | "tx__ok" | "tx__bad" | "tx__warn" } {
  if (state === null) return { text: `Checking ${pair.symbol} on o1's factory on ${BASE.name}…`, tone: "dim" };
  if (typeof state === "string") return { text: `o1's factory could not be read: ${state}`, tone: "tx__warn" };
  if (!state.open) return { text: `o1's factory has launch creation switched off right now.`, tone: "tx__bad" };
  if (!state.registered) return { text: `${pair.symbol} is not registered as a pair on o1's factory — o1 would refuse it.`, tone: "tx__bad" };
  return { text: `${pair.symbol} is a registered pair · creation fee ${formatAmount(state.fee, 18)} ETH — read from ${BASE.name}`, tone: "tx__ok" };
}

export function O1Launch() {
  const { wallet, signingProvider } = useWalletSession();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [image, setImage] = useState<Image | null>(null);
  const [pairs, setPairs] = useState<{ readonly pairs: readonly Pair[]; readonly problem: string | null }>({ pairs: CRYPTO_PAIRS, problem: null });
  const [pair, setPair] = useState<Pair>(CRYPTO_PAIRS[0]!);
  const [factory, setFactory] = useState<FactoryState | string | null>(null);
  const [editable, setEditable] = useState(false);
  const [rows, setRows] = useState<readonly Extra[]>([]);
  /** the plan, with what it was prepared for — a plan is only ever shown next to its own asks */
  const [prepared, setPrepared] = useState<{ readonly plan: LaunchPlan; readonly pair: Pair; readonly extra: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  /** o1's own health: `null` while checking */
  const [up, setUp] = useState<boolean | null>(null);
  const steps = useTxSteps();

  const check = useCallback(() => {
    setUp(null);
    void o1Up().then(setUp);
  }, []);
  useEffect(check, [check]);

  useEffect(() => {
    let current = true;
    void launchPairs().then((p) => current && setPairs(p));
    return () => {
      current = false;
    };
  }, []);

  /** The factory's answer for the picked pair, read from Base whenever the pair changes. */
  useEffect(() => {
    let current = true;
    setFactory(null);
    factoryState(pair.address).then(
      (s) => current && setFactory(s),
      (e: unknown) => current && setFactory(messageOf(e)),
    );
    return () => {
      current = false;
    };
  }, [pair]);

  /** Any edit throws the plan away: what was prepared is what gets signed. */
  const changed = () => {
    setPrepared(null);
    setError(null);
    setLive(null);
    steps.reset();
  };
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      changed();
    };

  const setRow = (i: number, part: keyof Extra, v: string) => edit(setRows)(rows.map((r, j) => (j === i ? { ...r, [part]: v } : r)));

  const onImage = async (file: File | undefined) => {
    setPrepared(null);
    setImage(null);
    steps.reset();
    if (!file) return;
    try {
      setImage(await readImage(file));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const ready = wallet?.kind === "ready" ? wallet : null;
  const extra = checkExtra(rows);
  const links = { Website: website, X: x, Telegram: telegram };
  const badLink = (Object.keys(LINKS) as (keyof typeof LINKS)[]).find((k) => links[k].trim() !== "" && !LINKS[k].pattern.test(links[k].trim()));
  const blocker = !ready
    ? "Connect a wallet first"
    : name.trim() === ""
      ? "Enter a name"
      : name.trim().length > NAME_MAX
        ? `Name is over ${NAME_MAX} characters`
        : !SYMBOL.test(symbol.trim())
          ? "Enter a symbol (1–11 characters, no spaces)"
          : image === null
            ? "Pick an image"
            : typeof factory === "object" && factory !== null && !factory.open
              ? "Launch creation is off on o1's factory"
              : typeof factory === "object" && factory !== null && !factory.registered
                ? `${pair.symbol} is not a registered pair`
                : badLink
                  ? LINKS[badLink].says
                  : bytes(description.trim()) > DESCRIPTION_BYTES
                    ? `Description is over ${DESCRIPTION_BYTES} bytes`
                    : "problem" in extra
                      ? extra.problem
                      : null;

  const onPrepare = async () => {
    setBusy(true);
    setError(null);
    const asked = pair;
    // the CTA is disabled while `extra` holds a problem, so here it holds the rows
    const entries = (extra as { readonly extra: Extra[] }).extra;
    try {
      const plan = await prepareLaunch({
        creator: ready!.account,
        pair: asked,
        editable,
        extra: entries,
        name: name.trim(),
        symbol: symbol.trim(),
        description: description.trim(),
        website: website.trim(),
        x: x.trim(),
        telegram: telegram.trim(),
        imageBase64: image!.base64,
        imageType: image!.type,
      });
      setPrepared({ plan, pair: asked, extra: entries.length });
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  };

  const plan = prepared?.plan ?? null;

  const onLaunch = async () => {
    const p = plan!;
    const receipts = await steps.run(
      signingProvider(),
      ready!.account,
      p.steps.map((s) => ({ label: s.label, build: () => s.tx })),
    );
    if (receipts !== null) setLive((await accountKind(p.token)).kind === "contract");
  };

  const line = pairLine(pair, factory);
  const crypto = pairs.pairs.filter((p) => p.market === "standard");
  const stocks = pairs.pairs.filter((p) => p.market === "rwa");
  const field = (label: string, value: string, set: (v: string) => void, placeholder = "") => (
    <label className="group__row">
      <span>{label}</span>
      <input className="field" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => edit(set)(e.target.value)} />
    </label>
  );

  return (
    <div className="stack">
      {up === false ? (
        <Crt label="o1 status">
          <span className="crt__amber">
            o1&apos;s launch service is not answering right now — its own health check fails, which is on o1&apos;s
            side. You can fill in the form; Prepare works once o1 is back.
          </span>
          {"\n"}
          <button type="button" className="chip" onClick={check}>
            Check again
          </button>
        </Crt>
      ) : null}
      <fieldset className="group">
        <legend>Pair on {BASE.name}</legend>
        <label className="group__row">
          <span>Paired with</span>
          <select
            className="field"
            aria-label="Paired with"
            value={pair.address}
            onChange={(e) => edit(setPair)(pairs.pairs.find((p) => p.address === e.target.value)!)}
          >
            <optgroup label="Crypto on Base">
              {crypto.map((p) => (
                <option key={p.address} value={p.address}>
                  {p.symbol}
                </option>
              ))}
            </optgroup>
            {stocks.length > 0 ? (
              <optgroup label="Stock tokens on Base">
                {stocks.map((p) => (
                  <option key={p.address} value={p.address}>
                    {p.symbol} — {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <p className={line.tone} aria-live="polite">
          {line.text}
        </p>
        {pair.market === "rwa" ? (
          <p className="dim">Stock-paired: your token trades against {pair.symbol}, and the trading fees you earn arrive in {pair.symbol}.</p>
        ) : null}
        {pairs.problem ? <p className="dim">Stock pairs are not listed right now: {pairs.problem}</p> : null}
      </fieldset>

      <fieldset className="group">
        <legend>Your coin</legend>
        {field("Name", name, setName, "e.g. Night Cat")}
        {field("Symbol", symbol, setSymbol, "e.g. QCAT")}
        <label className="group__row">
          <span>Image</span>
          <input
            className="field"
            aria-label="Image"
            type="file"
            accept={IMAGE_TYPES.join(",")}
            onChange={(e) => void onImage(e.target.files?.[0])}
          />
        </label>
        <label className="group__row">
          <span>Description</span>
          <textarea className="field" aria-label="Description" rows={2} value={description} onChange={(e) => edit(setDescription)(e.target.value)} />
        </label>
        {field("Website", website, setWebsite, "https://… (optional)")}
        {field("X", x, setX, "https://x.com/… (optional)")}
        {field("Telegram", telegram, setTelegram, "https://t.me/… (optional)")}
      </fieldset>

      <fieldset className="group">
        <legend>Options</legend>
        <label className="check">
          <input type="checkbox" checked={editable} onChange={(e) => edit(setEditable)(e.target.checked)} />
          <span>Let me edit the token&apos;s profile later — only the profile, never mint, burn, pause or ownership</span>
        </label>
        {rows.map((r, i) => (
          <div key={i} className="group__row group__row--extra">
            <input className="field" aria-label={`Extra key ${i + 1}`} placeholder="key" value={r.key} onChange={(e) => setRow(i, "key", e.target.value)} />
            <input className="field" aria-label={`Extra value ${i + 1}`} placeholder="value" value={r.value} onChange={(e) => setRow(i, "value", e.target.value)} />
            <button type="button" className="chip" aria-label={`Remove extra ${i + 1}`} onClick={() => edit(setRows)(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <div className="group__row group__row--actions">
          <button type="button" className="chip" onClick={() => edit(setRows)([...rows, { key: "", value: "" }])} disabled={rows.length >= EXTRA.rows}>
            Add extra information
          </button>
        </div>
        <p className="dim">
          Extra information is public in the token&apos;s profile (up to {EXTRA.rows} key/value rows). Dev Buy is not part of o1&apos;s public
          API — buy your own token on o1.exchange once it is live.
        </p>
      </fieldset>

      {plan === null ? (
        <Gel className="mf__cta" onClick={() => void onPrepare()} disabled={blocker !== null || busy}>
          {busy ? "Preparing with o1…" : (blocker ?? "Prepare with o1")}
        </Gel>
      ) : (
        <>
          <ReportView report={planReport(plan, ready!.account, prepared!.pair, prepared!.extra)} />
          <Gel className="mf__cta" onClick={() => void onLaunch()} disabled={steps.running || steps.states.length > 0}>
            {steps.states.length > 0 ? "Launched — edit a field to start another" : "Launch in wallet"}
          </Gel>
        </>
      )}

      {error ? (
        <Crt label="Launch error">
          <span className="crt__amber">{error}</span>
        </Crt>
      ) : null}
      <TxStepList states={steps.states} label="Launch progress" />
      {live === null || plan === null ? null : (
        <p className={live ? "tx__ok" : "tx__warn"}>
          {live ? "Your token is live: " : "The launch confirmed, but no contract is at the predicted address yet: "}
          <a href={explorer.token(plan.token)} target="_blank" rel="noreferrer">
            {plan.token}
          </a>
        </p>
      )}
    </div>
  );
}
